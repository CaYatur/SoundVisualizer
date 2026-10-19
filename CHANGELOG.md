# Changelog

What changed in each release, grouped by area. Numbers in brackets are pull requests or issues on
GitHub. The full reasoning and the measurements behind each change are in [ROADMAP.md](ROADMAP.md).

## v3.1.6-beta — in code, not released

`package.json` on `main` is 3.1.6-beta. There is no tag and no GitHub Release yet. The in-app
updater sees v3.1.5 as the latest release and does not offer it to the beta as an update.

### Control panel

- **Interface themes [770].** Settings → Application → Interface Theme offers seven themes and
  Device default:
  - CaYaDev, the existing look and still the default;
  - Dark, a neutral graphite;
  - Light;
  - High Contrast, black with yellow, held to WCAG AAA (7:1 for text);
  - Midnight, Sepia and Neon.

  Device default follows the operating system's light or dark preference and switches live.
  The theme changes the panel only. The visualizer output, the stream overlay and your own
  colours stay as they are. It is saved in the settings file, so a backup carries it, and
  "Reset to Defaults" keeps it.
- **Every panel colour comes from one table.** `src/shared/ui-themes.js` defines 64 colour tokens
  per theme. `admin.css` and `studio.css` no longer contain a colour outside the CaYaDev `:root`
  block. The timeline and projection-mapping canvases read the same tokens and redraw when the
  theme changes. The window opens in the theme's background, so a light theme does not flash
  dark first.
- **Readability is tested, not assumed.**
  - Every theme is checked against 143 contrast rules: 4.5:1 for text on every surface, button
    text in the middle of the gradient, the code editors, focus rings and switch knobs at 3:1.
  - Every rule in the panel's CSS that sets both a text colour and a background is measured in
    every theme.
  - A guard fails when a colour is written into the panel CSS or a panel script outside the
    table, so a new panel cannot break a theme quietly.
  - The self-test selects every theme from the picker, walks every category, and measures the
    colour Chromium actually draws for each visible text against its background: about 2,600
    texts per theme, none below the threshold.
- **CaYaDev looks the same, with these visible changes.**
  - Four colours moved so the default theme passes the same test:
    - the small hint text was 3.4–4.4:1 on cards and is now at least 4.5:1;
    - code comments in the shader editor were 3.3:1;
    - white text on the solid red danger button was 3.9:1;
    - the end of the red gradient on filled buttons is slightly deeper, so white text reads in
      the middle of the gradient too.
  - Near-identical shades became one per role. Error text had six reds across the panel and
    Studio, and now uses one. The status greens and ambers each come down to one fill shade and
    one text shade.
  - The Performance View had its own neutral greys. It now uses the panel's surfaces.
  - The lyric editor and the MCP setup snippets use the code editor's background and text colour.
  - Studio's solid danger button is the panel's red.
  - The projection-mapping guide line is the panel's info blue instead of cyan. A selected tempo
    marker on the timeline is drawn in the strong text colour.
- **Clip Deck cells stay readable in any slot colour.**
  - A cell's background is tinted with the slot colour. On a white slot, the small info line fell
    to 3.3:1 on hover. The tint is now 10%, and 12% on hover, with a stronger border showing the
    hover.
  - Countdown numbers use the readable amber. They were 3.5:1 in Light.
  - A slot with no source was faded with opacity, so its name fell to 3.3:1. It now has a dashed
    border, no tint and secondary text.
  - The empty-cell "+" was drawn in the line colour, at 1.5:1. It is now secondary text.
  - The Auto VJ conflict note uses the amber meant for text, which is paler in CaYaDev.
  - A test checks every text in a cell, in every state, on white, black, grey and the six primary
    and secondary colours. The self-test now measures clip cells too and reads `color-mix()`
    backgrounds. Before, it skipped them and measured the text against the card underneath.
  - In a cell that shows a scene preview or an image, the name, info line and countdown now sit on
    their own card-coloured backing. The preview stays visible around them. On a white scene
    the text used to fall below 3:1, and the info line was drawn underneath the preview.
- **The selected scene's info line** was 3.9:1 in Light and 4.1–4.4:1
  in Midnight and CaYaDev. On the selected row's accent tint it now uses the secondary text
  colour, and the contrast rules cover body and secondary text on selected rows.
- **Two labels were unreadable in every theme.** The empty side of the A/B crossfader and the
  "built-in" tag in Studio's list were dimmed with opacity to 2.9:1 and 3.7:1. They now use the
  secondary text colour. The decorative "·" separators in status lines are hidden from screen
  readers.

### Video export

- **Eleven formats instead of one MP4 [521].** H.264 and H.265 in MP4, ProRes 422 HQ and DNxHR HQ
  in MOV for editing, VP9 in WebM, GIF and APNG for short loops, and PNG and OpenEXR frame
  sequences. The list is data in one module (`src/shared/export-formats.js`): the panel, the MCP
  schema, the path check and the ffmpeg arguments all come from it.
- **AMD and Intel GPUs encode too [521].** "GPU" meant NVIDIA only and quietly fell back to the CPU
  elsewhere. It now picks the first working encoder of NVENC, AMF and Quick Sync. Every encoder is
  test-encoded at start with the exact arguments a real export uses, and one that fails is not
  offered. AMF and NVENC were verified on this machine; Quick Sync was not, for lack of an Intel GPU.
- **Colours match the screen [521].** ffmpeg converted HD frames to YUV with the BT.601 matrix and
  left the file untagged, so players read it as BT.709 and shifted the colours. Frames are now
  converted with BT.709 and tagged. On a test pattern the average error fell from 8.9 to 1.2
  levels (worst case 45 to 36).
- **Transparent exports [525].** ProRes 4444, VP9 with alpha, APNG, PNG and EXR keep the alpha
  channel. The scene is drawn under the same rule as the streaming overlay: no background is
  painted, and a background effect's dark areas key out. The master fader fades to transparent
  rather than to black. MilkDrop stays opaque, as it does in the live overlay.
- **Frame sequences [529].** PNG or OpenEXR, one file per frame, written into a new folder named
  after the chosen file. EXR holds linear light in half floats; colour and alpha take separate
  paths, because zscale alone treated alpha as limited range (0.091 off) and swscale's float
  conversion was 0.004 off. A cancelled sequence removes its folder.
- **Portrait, square and more frame rates.** 1080×1920 and 1080×1080, and 24, 25, 30, 50 and
  60 fps. GIF and APNG cap at 30.
- **Export is about three times faster [531].** For H.264, H.265 and VP9 the frame is converted
  to BT.709 I420 on the GPU, so 3.1 MB crosses to ffmpeg instead of 8.3 MB and ffmpeg converts
  nothing. The main process no longer copies each frame a second time, and the colour conversion
  that remains runs on several threads. With 20 s of audio, fireworks at 1080p60 went from about
  31 s to 11 s, MilkDrop at 1080p60 from 31 s to 13 s, and MilkDrop at 4K from 60–67 s to 18–19 s.
  The conversion matches ffmpeg's to within one level on luma; the scene itself is drawn exactly as
  before.
- **One-click profiles [522].** YouTube 1080p60, YouTube 4K60 (H.265), Reels / Shorts / TikTok
  1080×1920, Instagram square, a Twitch / OBS overlay in WebM with alpha, a ProRes 422 HQ 4K
  master and a 720p GIF loop. A profile sets the format, size, frame rate and quality; the GPU or
  CPU choice and the speed balance stay yours. The profile is read from the settings themselves, so
  changing any of them by hand shows "Custom", and every setting stays available underneath. MCP's
  `sv_start_export` takes a `profile` too, with explicit arguments taking precedence.
- **Two render modes, named apart [530].** The export card is the offline mode: an audio file
  drawn frame by frame as fast as possible, the same video every time. The recording card is the
  realtime mode: what is on screen with the live audio. Realtime recording can now follow the
  timeline: it starts when playback starts and stops on pause, stop or the end of the timeline,
  whether the transport is driven from the panel, MIDI, OSC or MCP.
- **A batch queue [526].** Queue the current song with the current settings, or several audio
  files at once into one folder, and start the queue. Each job keeps the scene and settings from
  the moment it was added, so you can change the scene and queue the next variation; one song at
  three resolutions gets three distinctly named files. A failing job is marked and the next one
  runs. Each row shows its status, failed or cancelled jobs can be retried, and Stop cancels the
  running job without leaving a half-written file.
- **Split a long show at the timeline markers [527].** One render is cut at forced keyframes into
  a folder of files named after the markers ("01 - Intro.mp4", "02 - Drop.mp4"), so feedback
  layers like MilkDrop run continuously across the cuts instead of restarting cold in each part.
  Measured on H.264 (x264 and NVENC), H.265, VP9 and ProRes: chapters of exactly 60, 45 and 45
  frames for markers at 2 s and 3.5 s, each starting on a keyframe. AMD's AMF ignores forced
  keyframes, so chapters use the next encoder that honours them.
- **Choose how long the export runs [523].** The length of the audio file (as before), a fixed
  number of seconds, the length of the timeline, or N bars at a BPM (or at the timeline's tempo).
  Video and audio come out exactly that long: shorter audio is padded with silence, and longer
  audio is cut (a trimmed MP3 is still copied, not re-encoded). An empty timeline is refused with
  a reason instead of rendering nothing.
- **Scene and BPM go into the file [528].** The save dialog suggests "Track - Scene - 128 BPM",
  with characters Windows forbids and reserved names like CON removed. The file's comment carries
  the scene name and BPM next to the title, artist and album.
- **A cancelled export leaves nothing behind [532].** The file is written under a `.partial` name
  and moved to its real name only when ffmpeg finishes cleanly, so a cancel, an error or quitting
  the app never leaves a half-written file at the chosen path. Quitting during an export used to
  leave ffmpeg running; it is now stopped and its partial output removed. The status line shows
  frames per second and the time left.
- **The panel opens without waiting for the encoder probe [521].** GPU encoders are tested one at
  a time, and a saved "GPU" choice is no longer rewritten to "CPU" on a machine without one; the
  export runs on the CPU and the box shows it.

### Studio

- **New presets start in the app language [772].** In English, Studio → "+ Shader" opened a visualizer
  named "Yeni Görselleştirici", and the discard-changes prompt showed that Turkish name. The name,
  the default "Amount" slider label, the variation names and the starter shader's comment header
  become the user's own editable text, so they are now written in the UI language at creation,
  like the import fix in [759].
  A new draft that was not edited no longer asks before it is discarded (it did in both languages
  before), and the self-test's untranslated-text scan skips user content marked with
  `data-user-text` / `data-user-attr`, so saved preset names are no longer flagged.
- **Imported presets follow the app language [759].** A `.milk`, Shadertoy or ISF file imported
  through Studio got a Turkish description even in English, and the import notes stayed Turkish.
  The description is the user's own editable text once saved, so it is now written in the UI
  language at import. The notes are translated one by one rather than as a joined sentence, the
  three missing ones were added, and the ISF note that carries an input name from the file
  translates through a pattern.

### Audio

- **Per-application audio capture on Linux [514].** Pick one or more applications as the source,
  or capture everything except one. It uses PulseAudio's per-stream monitors through `pactl` and
  `parec` (pulseaudio-utils), so no new binary ships, and it should work under pipewire-pulse too,
  although only PulseAudio was tested. Streams that start mid-capture are picked up, and a closed
  application is re-attached by name when it reopens. When the tools or the sound server are
  missing, the panel says what to install or start. Verified in WSLg: a captured 440 Hz tone read
  0.5 while another app at 0.2 stayed out, and the reverse in exclude mode.
- **Per-application audio capture on macOS 13+ [517], not yet run on a Mac.** A ScreenCaptureKit
  helper captures one application or everything except one. It needs the Screen Recording
  permission; the panel explains this and has a "Request Screen Recording Permission" button, and
  the app never asks on its own. The helper compiles on CI's macOS runner, but nothing about its
  behaviour has been observed on real hardware.
- **A live level meter for every application in the picker [516].** Choosing an application only
  works if you can see which one is making sound. Each row now has a moving bar on a dB scale next
  to its audible/silent icon. The helper reads every audio session's peak meter
  (`IAudioMeterInformation`) about 16 times a second, and only while the picker is on screen and
  the panel is neither minimised nor hidden; it costs about 0.4% of one core. Several processes of
  one app share one bar, which shows the loudest. A missing or older helper keeps the icons.
- **The app no longer lists itself as a source [516].** The capture child that records the system
  mix runs from our own executable and opened an audio session of its own, so the picker offered
  the visualizer itself, and its meter followed the whole mix. Our own processes are now left out.

### OSC

- **OSCQuery discovery follows network changes.** The mDNS announcement kept the address it started
  with, so after switching from Wi-Fi to cable or getting a new DHCP lease, discovery pointed at the
  old IP until OSC was turned off and on. The address is now re-read before every announcement and
  reply, a change is announced within 10 seconds, and the address records carry the cache-flush bit
  so listeners replace the old address instead of keeping both.

### MCP

- **`sv_get_now_playing` leaves the cover art out unless asked [755].** The cover is a data URI
  that can run to hundreds of KB, and a small model that receives it can lose the track title in it.
  The tool now returns `hasArtwork` and sends the cover only with `includeArtwork: true`.
  `sv_get_state` never carries it. Clients that showed the cover need to pass the flag.

### MilkDrop

- **A still motion-vector field draws its stubs down and to the right, as MilkDrop does [751].**
  Where nothing moves, MilkDrop draws a one-texel stub at `dx = dy = min_len`. Its 2D projection
  flips y, so on screen that stub points down; ours pointed up.
- **Motion vectors are drawn into the warp's source, before the warp, as MilkDrop does [752].**
  They were drawn on top of the finished frame. Now, as in MilkDrop, they read the previous frame's
  mesh, pass through the warp once, fade with `decay`, sit under shapes and waves, and reach blur and
  textured shapes. A preset with `decay = 0` showed vectors that MilkDrop never shows.
- **Motion vectors include MilkDrop's half-texel offset [752].** MilkDrop adds half a texel to its
  mesh coordinates for Direct3D 9's pixel centres, and the motion vectors read that half texel as
  movement. So even a still field draws short diagonal strokes that grow with `mv_l`, and presets
  that push `mv_l` into the thousands turn them into rays across the screen ("Sensual Enjoyment").
  The engine had no such offset and drew those presets almost empty.
- **Anti-aliased lines draw MilkDrop's footprint and leave MilkDrop's light in accurate mode
  [752].** The "Smooth" style used to leave 2 to 5 times MilkDrop's light, and feedback presets near
  saturation blew out (De-Orbit, Answer42, Music Box). Waves, shape outlines and motion vectors now
  draw MilkDrop's one-texel line, or its two-texel block for thick lines, with soft edges. Above
  1024 wide the line grows with the resolution, so at 4K it keeps the share of the picture it had in
  the buffer the preset was written for. "Thin" draws MilkDrop's footprint at every resolution. With
  accurate mode off, both styles keep their old calibration.
  - The "Smooth" option is renamed "Anti-aliased (scales with resolution)".
  - Measured against patched MilkDrop on 120 presets that draw motion vectors, over the presets
    without user textures or randomness: the median frame-59 difference fell from 28.1 to 5.3, with
    no preset worse at frames 2, 10, 30 or 59.
- **Blur levels 2 and 3 are no longer one and two frames behind [752].** Each blur level read the
  previous level through mipmaps that were only rebuilt after the whole chain, so it got last
  frame's image. Each level now reads the base level, as MilkDrop does ("liquid firesticks" frame 2:
  26.7 → 2.3; "Tricolors" frame 30: 71.0 → 8.8).
- **`sampler_main` wraps in preset shaders, as MilkDrop does [752].** MilkDrop sets the wrap mode
  from the sampler's name; a plain `sampler_main` wraps, and `bTexWrap` only applies to presets
  without a warp shader. The engine followed `bTexWrap` in shaders too, so content leaving the
  screen stuck to the edge. This covers 3,325 corpus presets (34%). Blur now always reads clamped,
  and textured shapes read clamped after a blur pass, both as in MilkDrop ("truth, rarity" frame 30:
  23.8 → 8.4).
- **The feedback rounds to 8 bits, as MilkDrop's does [752].** MilkDrop's buffer rounds every write to
  the nearest 1/255, so a small per-frame increment either always moves a level or never does, and a
  decay stops at a floor. Our 10-bit buffer ran these differently: "Dead CellWerx" flooded with red
  (frame 59: 20.0 → 8.7). In accurate mode the warp's output is now rounded the same way. The buffer
  stays 10-bit, so waves, shapes and lines drawn after the warp keep their soft edges.

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
