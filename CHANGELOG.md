# Changelog

What changed in each release, grouped by area. Numbers in brackets are pull requests or issues on
GitHub. The full reasoning and the measurements behind each change are in [ROADMAP.md](ROADMAP.md).

## v3.1.7-beta

### Visualizer

- **Nine CaYaDev presets are back to their MilkDrop 3 originals in the app** (Harmonograph, Harp Strings,
  Twelve Moons, Firefly Meadow, Constellations, Night Bloom, Tesla Coil, Smoke Ribbons, Spectrum City).
  The MilkDrop 2 packing from #894 made them look worse in our own engine, where the originals always
  worked. The pack uses the originals again, unchanged.
- **Preset folders match the preset version.** [`presets/original/md2/cayadev/`](presets/original/md2/cayadev/) holds the
  MilkDrop 2 originals, [`presets/original/md3/cayadev/`](presets/original/md3/cayadev/) holds only the MilkDrop 3 originals,
  and the app embeds both. Reduced copies for MilkDrop 2 players and older shader compilers stay in
  [`presets/compat/md/cayadev/`](presets/compat/md/cayadev/) and are not in the preset list. Those copies stay within MilkDrop 2
  limits (q1 to q32, at most four custom waves and shapes, no pw_ samplers). `CaYaDev - Spectrum City Old Compiler.milk`
  in that folder is the older-compiler copy: it drops the antenna `tall` factor (antenna lights blink on every tower). The original Spectrum City is unchanged.
- **Arcade Invaders drops the pw_noise_lq sampler** and reads the same noise from noise_lq.
- **Arcade Invaders reacts to the music again** (CaYaDev MilkDrop pack). Beats now come from bass or treble
  peaks relative to the track's own level, so the cannon fires on the music (auto-fire only after a quiet
  stretch), the fleet's march and the alien bombs follow the bass, the cannon glides faster with the mids.
- **New preset: Arcade Invaders Score** (CaYaDev MilkDrop pack, id `md_caya_arcade_invaders_score`). The score and
  wave version from #889 ships as its own preset next to the bomb version: a score and wave counter run along the top,
  and when the fleet reaches the bunkers a red alarm clears the score.
- **Arcade Invaders Score: shot aliens no longer come back** when the fleet reaches the bunkers. The red
  alarm now clears the score and pushes the surviving aliens back to the top; the full fleet returns only
  when a wave is cleared.
- **Arcade Invaders plays a real game** (CaYaDev MilkDrop pack). The cannon's shots used to pass through
  everything and only made an alien flash. Now each shot hits: an alien it strikes explodes and is gone,
  and a shot or an alien bomb that reaches a bunker chips a piece out of it. The aliens drop zigzag bombs
  that can hit the cannon, a mystery saucer crosses the top from time to time, and the cannon glides to a
  column that still has aliens and fires on the beat. The fleet marches faster as it thins out. Once it
  is cleared a new, faster wave starts lower down with fresh bunkers. The preset id stays the same.
- **Colour mode for Studio visualizers** (#883), on the Visualizer card and on a Studio layer. The
  Studio shaders draw with a five-colour palette that always came from the background gradient. It
  can now be *Colour Theme* (as before, the default), *Fixed Colour* (primary to secondary colour) or
  *Rainbow* (hues that move with the draw clock, so exports match). It has its own setting, so
  scenes that use a colour mode on another visualizer keep their Studio colours.
- **More options for bars** (#879), on the Visualizer card and on a bars layer. With their defaults
  the bars draw exactly as before.
  - *Bar Style*: solid, or segmented LED blocks with a block size and gap.
  - *Corner Roundness*, from square to fully round (0.4 before).
  - *Fill*: flat, or a vertical gradient from the base to the height of the tallest bar.
  - *Grow Direction*: up, or down from the baseline. The layout editor box follows it.
  - Peak caps: *Peak Hold* time, *Peak Fall Speed*, and an own *Peak Colour*.

### Fixes

- **New visualizer layers start at factory settings.** A new layer took over values from the scene's
  visualizer (for example *Glow* 80%), so it showed reset badges on *Sensitivity*, *Glow* and *Bar Gap*
  from the start. It now starts with the defaults that *Reset* returns to. The reset targets of the
  layer card (*Sensitivity*, *Glow*, *Bar Count*, *Bar Gap*, *Line Width*, *Amplitude*, logo *Glow*)
  now come from the same defaults instead of separate hand-written values.
- **Bars layer choices now show at once.** On a bars layer, picking *Flat* or *Vertical Gradient*
  for *Fill*, or *Up* or *Down* for *Grow Direction*, changed the drawing but left the old button
  highlighted until you went to another category and back. The layer's two-way and three-way
  choices now always highlight the current value, also after a reset to default.
- **New layers show their real defaults.** A freshly added bars layer showed *Bar Width*, *Horizontal
  Position*, *Bar Height* and *Baseline* at 0% with a reset badge, although it drew with the normal
  layout, so *Reset* seemed to do nothing. Unset values on layer cards now show the value the layer
  draws with, and the badge appears only for real changes.
- **The panel no longer jumps to the active MilkDrop preset** (#877). Once the preset list had been
  scrolled, every change on the Scene page scrolled the page to the active preset: muting a layer moved
  it from 1135 to 3517 px. The list now scrolls only itself. The template grid and the Studio preset
  list used the same call and are fixed with it.
- **3D geometry and feedback layers can be set up again** (#881). With the layer stack on, their
  settings cards were never shown, so a geometry layer's family and formula could not be changed
  anywhere. Like the MilkDrop card, both now appear when a layer of that kind exists.
- **A bars layer has every bar setting of the Visualizer card** (#878). Floor reflection and its
  length were missing from the layer card. The frequency range and the eight spectrum metering
  settings were missing too; they are on a new *Spectrum Metering* tab of every layer that reads
  frequency bands. Peak caps can now be turned off on both cards; they were always on.
- **Two layers of the same bar count no longer share one meter** (#878). They stepped attack and
  release twice per frame, so the second layer's bars moved twice as fast, and different attack or
  release settings mixed. Each setting combination now has its own meter, measured once per frame.
- **Peak caps fall at the same speed at any refresh rate** (#878). They fell about 5.8 times faster
  at 144 Hz than at 60 Hz, so a 60 fps export did not match a 144 Hz screen. At 60 Hz they fall
  exactly as before.

## v3.1.6 — 2026-10-29

The broadcast layout editor (#533) and redundancy (#540) were first planned for v3.1.7 and v3.2.0.
They were built ahead of time and ship in 3.1.6, together with video export. The sections up to the
CaYaDev presets and the audio bridge came after the 3.1.6-beta build; the ones after them were in it.

### Spout/Syphon input and web page layers [866]

Two new layer kinds bring pictures from outside the app into a scene. Each source opens once in
the main process, and its frames go to every output as shared GPU textures: the screens, the panel
preview, the Spout/Syphon output and the exporter. The OBS overlay cannot take a GPU texture, so it
gets them as WebP frames over the stream server, which keeps transparency.

- **Spout/Syphon input.** Pick a sender from the list. The app's own output is left out, including
  the `_1` name Spout gives it after an unclean exit, so the picture cannot feed back into itself.
  - **Settings:** fit, mirror, vertical flip, keep or drop the sender's alpha, and hold the last
    frame when the sender stops. Alpha is dropped by default because many senders write
    meaningless values there and the picture would not show.
  - **Reconnection.** It follows what was measured with texture-bridge 0.15.0 on Windows:
    - A new receiver reports "not connected" until its first receive call, and that call makes
      the connection.
    - A receiver made before its sender starts, or before a sender restarts, never connects. It
      was watched for 14 s. So the app rebuilds it once the sender is listed.
    - A sender that comes back as `Name_1` after a crash is found when it is the only such name.
  - **Measured:** 64–66 fps from a 60 fps sender. When the app was opened first, the sender
    started later, then killed and restarted, the layer reconnected each time.
  - **On a real Mac**, from the macOS CI job: creating a receiver for a server that does not exist
    throws, where Windows creates it and reports "not connected". The app creates a receiver only
    once the server is listed, and counts this error as waiting.
- **Placement.** Both kinds have their own position and size (`x`, `y`, `size`), stored in the
  layer like the logo's position. The picture is fitted into that box. The Layout Editor lists
  both kinds and can drag and resize them. Mirror and flip turn around the box's own centre.
  Layout files carry the box but not the sender, address or CSS, and importing a layout does not
  add a layer with no source.
- **Web page.** Any http/https page as a layer: alerts, chat, a scoreboard, a clock.
  - **Settings:** page size (up to 3840×2160, portrait sizes too), 15/30/60 fps, zoom, transparent
    background, custom CSS, automatic reload and page sound (off by default).
  - **Buttons:** an Interact window opens the same page so you can sign in or answer a cookie
    prompt, and the layer reloads when it closes. There are also Reload and Clear Web Layer Data.
- **Web page security.** The page is untrusted.
  - **Session:** it runs in its own partition with no preload, sandboxed, with dev tools off.
  - **Refused:** every permission, device chooser, screen share, download, pop-up, alert,
    `beforeunload`, HTTP auth prompt and client certificate. Without a handler, Electron sends the
    first certificate in the system store to any site that asks.
  - **Navigation:** main and sub frames may go only to http/https.
  - **Local network:** the app's own servers (stream page and remote, MCP, OSCQuery, audio bridge,
    redundancy) are blocked, and so are loopback, private, link-local and local-name addresses.
    - A local address you typed opens only that origin, and only from that layer. Another layer's
      page cannot reach it.
    - DNS rebinding is checked against the resolved address.
    - WebRTC exposes only the public interface, so a page cannot read the machine's LAN address.
  - **Closing itself:** a page can no longer close its own hidden window with `window.close()`.
    Before the fix the frames froze while the status still said loaded. Quitting the app,
    signing out and shutting down still close the window.
  - **Red-team page.** A test page tried all of these from inside a layer. Every attempt was
    blocked and no file reached the downloads folder. It tried:
    - the app's own port by IP, by `localhost` and over WebSocket;
    - `localtest.me` and `127.0.0.1.nip.io`, public names that resolve to loopback;
    - another layer's local origin, the LAN, `file:` and `sv-media:`;
    - camera, notifications, location, clipboard, MIDI, a pop-up and a download.

    A public control request went through.
- **A handle leak found in the 20-minute run.** The app ran with an input layer, a web layer and
  the Spout output for 20 minutes. The main process gained one handle per input frame, from 3412
  to 85 893.
  - **Cause:** texture-bridge's notes say Electron takes ownership of the handle on import.
    Electron's source shows it does not: Windows duplicates the handle, and macOS retains its own
    IOSurface reference. The caller's handle is left open on both platforms.
  - **Isolated:** painting, sending to Spout, the web layer, and receive-then-close all stayed
    flat. Receive-then-import alone leaked 64 handles per second.
  - **Fix:** the handle is now closed right after import. The leak was zero, and the picture was
    unchanged at 60 fps.
- **Robustness:**
  - Every imported texture and native handle is released on every path, including failed imports
    and windows that close mid-transfer.
  - A window still taking the previous frame is skipped rather than queued.
  - If import fails three times, the source falls back to bitmaps. Linux web layers always use
    bitmaps.
  - A crashed page reopens after 1, 2, 4, 8, 16 and 30 s, then waits for Reload.
  - A source that leaves the scene closes after 3 s, so a crossfade can finish.
  - A muted or soloed-out layer keeps its source open without drawing.
- **Video export** draws the live frame at drawing time, and the export page says so. Export does
  not run in real time, so moving content does not match the video's speed.
- **MCP:** `sv_add_layer` accepts `input` and `web`.
- **Tests:** 36 new tests cover:
  - URL and local-network classification, including the IPv6, IPv4-mapped, hex and decimal forms;
  - the guard's decisions and session hardening;
  - the frame hub with a fake GPU and a fake receiver modelled on the measured behaviour;
  - the shared preload block, quitting with a web layer open, and the Layout Editor kinds;
  - the real native module on Windows and on the macOS CI runner. On the runner the module loads
    and lists Syphon servers, and a missing server is refused. A send-and-receive test inside one
    process got no frame and was skipped, so receiving from a Syphon sender is not verified yet.

### For music videos and short video [837, 838, 839, 840, 841, 842, 843]

- **Seamless loops and a Spotify Canvas profile [840].** A new export option, "Seamless loop", is off by default.
  - **Method:** feedback and MilkDrop states are not periodic, so the last frame of a normal render never meets the first. A loop export renders the length L plus a crossfade X (0.2–2 s, default 0.5, at most half of L). One ffmpeg filter chain (`split`/`trim`/`xfade`) then starts the output at frame X and blends its last X seconds with the first X. The file is exactly L long and its last frame flows into its first.
  - **Scope:** the render core is unchanged. Loops are silent, because a cut-and-joined audio track would be heard. The option is unavailable with chapters and frame sequences. GIF and APNG loops close the same way.
  - **Spotify Canvas profile:** 1080×1920, 30 fps, 8 s, looped and silent. Every other profile now turns the loop off. A profile's duration is merged rather than replaced, so bars and BPM are kept, and settings saved before this release still match their profile.
  - **Measured** (720p30, 3 s, 0.5 s crossfade): 90 frames, yuv420p, and two runs byte for byte identical. The jump from the last frame to the first is 1.00, within the normal frame-to-frame change (mean 0.51, max 1.22; 160×90 grey). The first version came out yuv444p on the GPU I420 input path; the chain now ends in `format=yuv420p` there.

- **Title Card and End Card templates [843].** Two new templates in the Music Video group (83 templates now), for the start and end of a video, as clips on the timeline or on their own. Title Card brings the cover in at the centre with a scale reveal and the track title and artist beneath it. End Card brings in a free closing line ("Thanks for listening", editable) and fades in the cover and track details. Both have a thin line of bars along the bottom. Cover, title and artist come from the usual Now Playing layer, so they show the song's own details. Like every template, applying them leaves audio, display, streaming and lighting settings alone. Checked in an export.

- **Ken Burns and beat pulse on the media layer [841].** Both are off by default.
  - "Ken Burns" adds a slow zoom (up to 12%) and pan over the video or webcam, with its own cycle length (4–60 s, default 20). The pan never shows the frame's edge, because it is limited to the margin the zoom leaves.
  - "Beat Pulse" adds a short zoom peak (up to 8%) when the bass rises clearly above its slow average, fading in about 0.3 s.
  - Both follow the draw clock, not the wall clock, so an export shows the same motion as the screen.

- **Floor reflection for bars [842].** Bars that stand on a baseline above the bottom edge can cast a mirrored reflection that fades downward. "Floor Reflection" sets the strength (off by default) and "Reflection Length" the length as a share of the bar height. The canvas is drawn onto itself flipped under the baseline, then faded with a gradient that erases only below the baseline. It depends on nothing but the audio, so live and export match: a new `npm run parity` case shows no difference (24 cases, 0 failed). Checked in an export with music.

- **YouTube thumbnail [839].** A "YouTube Thumbnail" button next to Snapshot saves a 1280×720 JPEG of the frame on screen. If the image is too big, quality steps down from 0.92 until it fits YouTube's 2 MB limit, and a source that is not 16:9 is cropped from the centre, so no bars appear. The frame comes from an open output window at its full resolution: the panel preview measured 341×192 in a small window, and enlarging it adds no detail. The preview is used only when no output window is open. Checked in the running app: from a 1280×1024 output window, a sharp 1280×720 JPEG of 31 KB.

- **Short-video interface guides in the layout editor [838].** At 9:16 and 1:1 the editor also shows hatched areas where short-video apps draw over the video. At 9:16 these are a top bar, a column of side buttons and a caption and navigation band, sized as the union of the three big platforms' current layouts and kept generous: at 1080×1920, 230 px top, 480 px bottom, about 150 px right and 60 px left. At 1:1 the hatched areas are the 12.5% on each side that the profile grid's 3:4 crop hides. These are guides only, under a "Platform interface" switch next to "Safe areas", and nothing reaches the output. Checked in the running app at both ratios.

- **YouTube chapters from the timeline markers [837].** "Copy YouTube Chapters" in the timeline's marker list puts them on the clipboard as "0:00 Intro" lines for a video description. A new export option (off by default) writes the same list to "<video name> - YouTube chapters.txt"; when the export is split into chapters, it goes into the folder. A marker at 0 names the first chapter; otherwise a "Start" line is added, and unnamed markers become "Chapter N". YouTube only treats the list as chapters when the first is at 0:00, there are at least three and each lasts at least 10 seconds; the list is still written, and the panel says which rule fails. Markers after the end of the video are left out. Checked with a real export (single file, split folder, no markers: no file).

### 10-bit H.265 export [858]

- **A twelfth format, "MP4 — H.265 10-bit".** H.265 Main 10 (`yuv420p10le`) with the same BT.709 tags and `hvc1` tag as the 8-bit file. It is for dark, smooth gradients: in 8-bit, the YUV conversion and the compression turn them into visible steps. The picture is still drawn in 8-bit RGBA, so 10-bit does not remove steps that are already in the drawing; it stops the encoder adding more. The existing formats and profiles are unchanged.
- **Measured** on a dark gradient scene (1080p30, 4 s), against the raw RGBA frames the renderer sent, at about the same file size: x265 48.35 → 49.87 dB PSNR (560 → 553 kB), NVENC 49.42 → 51.20 dB (740 → 710 kB). A contrast-stretched crop shows the 8-bit file's large blocks of flat colour; the 10-bit one follows the original gradient. ffprobe reports `Main 10`, `yuv420p10le` and the BT.709 tags for both encoders.
- **Encoders:** x265 on the CPU, NVIDIA NVENC and Intel Quick Sync. AMD AMF is not offered, because ffmpeg's AMF encoder does not take 10-bit input. 10-bit is probed separately from 8-bit (`hevc_nvenc@10`), since a GPU can encode one and not the other. Checked here: x265 and NVENC (RTX 5070). Quick Sync could not be checked on this machine; it is offered only where its own 10-bit test encode passes.
- **Speed:** this format does not use the GPU's 8-bit I420 conversion and sends RGBA frames instead, so it takes about 1.6 times as long as 8-bit H.265 (x265 2.9 → 4.6 s, NVENC 2.5 → 3.9 s for the 4 s clip).

### Audio analysis as files: JSON, CSV and MIDI [857]

- **What it writes.** A new export option, "Write the audio analysis next to it (JSON, CSV, MIDI)", is off by default. "Audio Analysis Only" writes the same files from an audio file without rendering video, in seconds (a 3-minute song at 60 fps took about 9 s). The files:
  - `<name> - analysis.json` and `.csv`: one row per video frame. Each row has every modulation source measured from the audio: bands, custom bands, loudness, timbre, the twelve pitch classes and the drum detectors. It also has the beat and downbeat of the beat grid, pitch, the chord of the current beat and the key.
  - The JSON also has a summary (BPM, key, how well the beat grid fits), events (beats, onsets, kick, snare and hi-hat with strength), chord and key sections, and a description of every field.
  - `<name> - analysis.mid`: beats, kick, snare and hi-hat on channel 10, the chords as notes, and markers for BPM and key. The file's tempo is the detected one, so the grid lines up with the song in a DAW.
  - Field names are the modulation source ids in English, so scripts keep working when the interface language changes. The CSV uses commas and a decimal point.
- **Frame alignment.** Row N is frame N of the video. The analysis runs on its own audio engine fed the same frame bytes, so the video does not change. `--bench-export` gave the same frame digest with the option on and off. Two runs, and an analysis-only run of the same file, gave byte-identical JSON, CSV and MIDI. Frame sequences and chapter exports write `analysis.*` inside their folder. The option is not available with a seamless loop, whose output starts in the middle of the render.
- **Whole-file analysis for the summary.** The live tempo and chord engines see only the past and are tuned to react fast for the visuals. On a 20 s excerpt, the tempo wandered from 172 to 80 BPM and the frame chord changed 136 times. With the whole song available:
  - **Tempo** comes from the autocorrelation of the loudness rise, weighted around 120 BPM. On four released tracks it agreed with the kick spacing (126.3, 126.3, 128.55, 104.85 BPM). An envelope from the eight spectrum bands gave 96 BPM on one of them, because those bands saturate on loud masters.
  - **The beat grid** keeps that tempo, with its phase fitted to the onsets. Downbeats are where the kick is strongest. `beatGridFit` in the summary reports how well a steady grid fits.
  - **Chords** come from the average pitch classes of each beat. A chord must last at least two beats. On the four tracks, the median chord section went from 0.48 s to about 2 s.
  - **The key** comes from the pitch classes of the whole file.
  - **Event times** are moved back by half the analysis window (21 ms), so they line up with the audio. Frame columns stay as frame N saw them.
- **Also over MCP.** `sv_start_export` takes `analysis: true`. A new tool, `sv_export_analysis`, writes only the analysis, so there are 97 tools.
- **Checked.** Known-answer tests:
  - a 120 BPM kick train gives 120 BPM and a grid within one frame of the kicks;
  - a C major triad gives a C chord and the key of C;
  - an eighth-note pulse picks the common tempo over its halves and thirds;
  - the MIDI file parses back: chunk lengths match, times only increase, every note closes, and kick times match the JSON.

  In the running app: an export with the option and an analysis-only run on four songs, and a cancelled analysis that left no files.

### Custom frequency bands as modulation sources [856]

- **Four "Custom Band" sources.** In the Modulation Matrix, each has its own frequency range (20 Hz–20 kHz, on a logarithmic slider) and dB window: the source is 0 at the floor and 1 at the ceiling, with its own attack and release. The eight fixed spectrum bands cannot isolate a kick's 50 Hz or a vocal's 3 kHz; these can. They appear in the route source list under "Custom Band", and a band does nothing until a route uses it, so existing scenes and exports are unchanged.
- **Method:** the level is read from the raw spectrum, before sensitivity and smoothing, so the dB window matches the real level. Bins are averaged as power, not as dB, so one loud peak in a wide band is not averaged away by its quiet neighbours. A band too narrow to contain a bin's centre reads the nearest bin. Attack and release follow the draw clock and are the same at any frame rate. Live, preview and export use the same audio engine and the same byte scale (-90 to -18 dB).
- **Default windows** (40–90 Hz, 150–400 Hz, 1.5–4 kHz, 6–14 kHz) come from levels measured on four released tracks: the floor at about the 10th percentile, the ceiling at about the 95th. The spectrum's scale stops at -18 dB, so a loudly mastered kick often reaches the ceiling.
- **Checked** in the running app in Turkish and English: the panel, saving, the source list and the live meters. New tests cover the byte scale, power averaging, narrow and reversed ranges, the dB window, frame-rate independence, invalid settings, and that an unrouted band leaves the configuration untouched.

### Fresh bridge profile and recording row

- **A fresh standalone bridge keeps its settings.** With `--bridge` and an empty profile folder (no `settings.json`), the bridge window's Settings tab ignored every change: "New Secret", the name and the port were dropped, the secret box stayed empty and the badge stayed "Secret missing". The window's write handlers (settings, sources, leaving bridge mode) now start an empty configuration on the first write, so the first change is saved and the badge becomes "Broadcasting". Checked in the running bridge under Xvfb with an empty profile folder; the normal app's first start is not affected.
- **Recording card at 1024 px.** The three buttons ran inline, so "YouTube Thumbnail" broke across lines and stuck to its neighbour. The row now wraps whole buttons onto the next line with a gap, and the timer stays on the right.

### Export loop, panel and bridge fixes

- **Seamless loop and Spotify Canvas exports work again [840].** ffmpeg stopped with exit code 234 ("xfade ... constant frame rate; current rate of 1/0 is invalid"): after `trim` and `setpts` the two branches had no frame rate, and `xfade` needs one. Each branch now ends in `fps=<fps>`. Checked with a real ffmpeg run (2 s at 30 fps: 60 frames, yuv420p, exit 0); the same command failed before the change.
- **Bar placement.** Switching "Placement" to Bottom now rebuilds the panel, so the Floor Reflection control appears at once; "Reflection Length" no longer waits for the reflection slider to be above zero.
- **Blend mode "Screen".** In an English UI the blend option showed "Display" because it shared a label with the display section. It has its own label now; the Turkish text is unchanged.
- **Audio bridge badge.** The bridge window showed "Starting" forever when no pairing secret was set. It now says "Secret missing", like the settings page.
- **Studio presets.** A long preset name that is cut off in the list shows in full on hover.
- **Layout import, by design.** A layout file with a text element adds a second visualizer-type layer (text is a sub-type of the visualizer layer): a fresh scene ends up with [background, visualizer, visualizer]. Importing the same file again updates those layers instead of adding more. Covered by a test.

### Web layer, Layout Editor and export fixes after testing

- **Web layer at the frame rate you pick.** On the CPU path (always on Linux, and wherever a GPU texture is unavailable) the page's frames were limited to 30 per second whatever the layer said, and the exact-interval check dropped every frame that arrived a little early, so "60" delivered about 46. The 30 fps limit is gone for web layers: the layer's own frame rate is the limit, with a small tolerance for timer jitter. The 8 MB copy is only made for frames that are sent, and the colour swap and the image buffer are reused. In a virtual-display run (xvfb, software rendering, a busy box) the frames reaching the panel went from about 22 per second to 37-57 with 60 selected; the page itself was painting at 60 both times. The Spout/Syphon input's GPU-readback fallback had the same 30 fps limit; it is gone too, so that path now delivers every frame the sender produces (a synthetic 1080p feed at 60 fps went from about 21 frames per second reaching the window to about 62), and the card is no longer read for windows that cannot use the picture.
- **Layout Editor: web, input and logo elements can be resized.** A handle sits on the box's bottom-right corner; drag it, or press + and - with the box selected (Shift for ten times the step). Only the "Size" field existed before.
- **Spout/Syphon output at the size you pick.** On the first start with 1920×1080 selected the sender came up as 1920×1032 (the work area without the taskbar), and 4K came up smaller still: the hidden window was clamped to the screen when it was created. The window is now forced to the requested size right after it is created, again when the page has loaded, and on every re-activation. Reproduced on a 1280×1024 virtual screen (the page painted 1279×1023 instead of 1920×1080 and 3840×2160; both are right after the fix).
- **Spout/Syphon output switch.** It no longer shows up, clickable, for a moment before the card is rebuilt on a platform that cannot send.
- **Layer status.** A web or input layer that is switched off, muted or not soloed shows "paused" and 0 fps instead of "live".
- **Page size on small screens.** The hidden page window was clamped to the screen, so a 1920x1080 page on a 1280x1024 screen was laid out at 1279x1023 and lost its aspect ratio. The window is sized after creation, so the page keeps the configured size.
- **Seamless loop with a live source.** A page with a running timer cannot meet itself at the loop point. The export now freezes web and Spout/Syphon layers at their picture when the export starts, and the panel says so.
- **Queued scene with a live source.** A queue job keeps the scene as it was when it was added. If that scene had a web or Spout/Syphon layer and the live scene did not, the layer came out black, because sources were opened only for the live scene. Sources of the job's scene now stay open while the job runs, and the export waits up to 5 seconds for their first frame. Checked in the app: a green test page in the queued scene came out black before (1, 0, 2) and green from the first frame after (19, 255, 9); the source closed when the job ended.
- **YouTube chapter list.** An export split into chapters now writes "YouTube chapters.txt" into its folder without the separate option; a single video still needs the option.

### English interface: the remaining Turkish text [868]

- **Translated** in the English interface:
  - the web layer's Reload button and Zoom choices;
  - formula parameter labels;
  - the built-in MilkDrop presets' descriptions and compile messages, which are now one message per line so each can be translated;
  - recording and export error messages;
  - the web layer window's title and the stream server's "invalid or missing token" reply, which follow the app's language.
- **Covered by a test** (`tests/i18n-english-leftovers.test.js`) that runs these strings through the English translation.

### Layout Editor and theme card fixes

- **Fresh profile no longer breaks on the first drag.** The Visualizer fields showed 0, 0, 0, 0 and the first drag wrote those zeros back, collapsing the bars into a small icon. Empty bar placement now resolves to the real defaults (position-aware, same as the renderer).
- **Theme cards keep keyboard focus.** After a mouse click or an arrow key the focus returns to the newly selected card, so the arrow keys keep working.
- **Layout export follows the UI language.** The default file name (`layout.json`) and the default layer names are English in an English UI.

### CaYaDev MilkDrop Presets [825]

- **Our own shader presets, built in.** 55 of them, ten for MilkDrop 3:
  - liquid: *Neon Monsoon*, *Oil Slick*, *Mercury Rain*, *Wax Lamp*, *Ocean Sunset* (a sunset sea with a path of glinting dashes);
  - tunnel: *Event Horizon*, *Data Corridor*, *Spiral Wormhole*, *Neon Arches*;
  - geometric: *Prism Lattice*, *Cymatics*, *Crystal Shards*, *Infinite Frame*, *Truchet Weave*, *Hex Reactor*;
  - ambient: *Northern Veil*, *Caustic Floor* (light focused through moving water onto rippled sand, bent by raindrop rings on the beat), *Rain Glass* (drops on a window that bend the city lights behind), *Snowy Pines*;
  - retro:
    - *Phosphor Scope*, *Synthwave Horizon*, *Spectrum City*, *Arcade Invaders*;
    - *Vinyl Groove*: a turntable that engraves the song into the record as a glowing spiral, groove width set by loudness;
    - *Halftone Pop*: a four-colour halftone print with screen angles and black outlines;
  - organic: *Coral Script*, *Ember Storm*, *Bioluminescence*, *Mycelium*, *Fern Frond* (four fronds grown by the chaos game);
  - space: *Hyperlane*, *Galaxy Spiral*, *Solar Flare*;
  - abstract:
    - *Kintsugi*, *Ribbon Dance*;
    - *Ink Bloom*: ink drops curling through water on paper, mixing like real pigment;
    - *Contour Survey*: a living contour map lit by sonar rings;
  - club:
    - *Laser Cathedral*, *Glitch Pulse*, *Plasma Globe*;
    - *Halo Spectrum*: a mirrored circular spectrum whose loud bars shed sparks;
  - fractal: *Julia Bloom*, *Mandala Mirror* (a feedback kaleidoscope), *Mandelbrot Dive*, *Apollonian Lace*;
  - MilkDrop 3:
    - *Twelve Moons*, *Night Bloom*;
    - *Spectral Ridges*: twelve ridgelines that hide the ones behind them;
    - *Tesla Coil*: eight discharges and a beat-struck arc to a grounded sphere;
    - *Harmonograph*: ten damped pendulum figures, each on its own plate;
    - *Smoke Ribbons*: eight incense sticks whose smoke rises and breaks into curls;
    - *Firefly Meadow*: twelve swarms blinking over a meadow at dusk;
    - *Harp Strings*: twelve strings, each tuned to its own slice of the spectrum;
    - *Constellations*: twelve star chains traced in turn across a turning sky;
    - *Lantern Night*: 48 sky lanterns from twelve instanced shapes, mirrored in a lake.

  They sit next to the five original built-ins in the preset list and auto advance, with English names and author "CaYaDev".
- **Free to use elsewhere under CC BY 4.0.** The `.milk` files are in [`presets/cayadev`](presets/cayadev) with a license and a README, and `node scripts/preset-pack.js --zip` builds the release zip (`CaYaDev-MilkDrop-Presets-<version>.zip`, now in the release asset list). The app embeds them from that folder; a test fails if the embedded copy drifts from the files.
- **A picture of each preset.** The folder's README is a gallery: one 960×540 frame per preset (in `previews/`, also in the zip), linked to its `.milk` file, with the English description as alt text. `node scripts/preset-pack.js` builds the gallery from `pack.json` and `--check` fails if it is out of date (rows added by hand had once landed above the table, where GitHub shows them as plain text).
- **Checked before they were added.** Each preset has warp and comp shaders. Each was run for 90 s on looped music (no fade to black, white-out or freeze) and measured at 1080p: 8.9–14.8 ms per frame on a Radeon 610M iGPU, 4.0–9.9 ms on an RTX 5070 Laptop, so 60 fps on both. All 55 were rendered at 60 and 144 Hz, and average brightness stays within −15% to +12% for every one. The largest gaps are *Night Bloom* −15%, *Phosphor Scope* −13%, *Fern Frond* +12%, *Halftone Pop* −12% and *Infinite Frame* +9%.

  *Prism Lattice* was −36%: each resample of the feedback buffer softens its thin rings, and at 144 Hz there are 2.4 times as many resamples. Its sharpening step now scales with `pow(q30, 0.4)` instead of linearly. Mean brightness at 30/60/144 Hz went from 75/44/28 to 50/44/43, and its 60 Hz picture is unchanged.

  Several other rules keep the presets consistent across frame rates:
  - The feedback buffers fade by at least one 8-bit step per frame, so dim trails no longer stick at high refresh rates. Before this, *Hyperlane* was 46% brighter at 144 Hz.
  - Per-frame additions scale with the frame rate.
  - Where the step of at least one per frame would eat a slow fade faster at 144 Hz, the step comes from a time tick in the frame code instead, a fixed number of 8-bit steps per second: *Mandala Mirror* went from −27% to +5%. The same tick lets *Vinyl Groove*'s grooves and *Harmonograph*'s figures stay on screen for a minute or more.

  The MilkDrop 2 presets were also rendered in MilkDrop 2 itself (BeatDrop) and show the same picture. Detail can differ where a preset grows from noise or chaotic feedback, because our noise textures are generated rather than MilkDrop's files. The MilkDrop 3 presets were checked in our engine; for the newest seven, MilkDrop 2 was also checked to show the documented fallback (the first four figures, ribbons, discharges, swarms, strings, constellations or lantern shapes).
- **MilkDrop 2 rules the comparison caught, now enforced by tests.** Our engine accepted all of these; MilkDrop 2 did not:
  - MilkDrop 2 does not pass `aspectx`/`aspecty` to custom wave and shape code, so the presets carry them in q31/q32. Shapes use them to stay round; custom waves must not: MilkDrop already stretches a wave's y by the aspect, so its coordinates are square on screen. Five presets multiplied wave points by q31/q32 and drew their rings and figures 1.78 times too tall on a 16:9 screen (*Phosphor Scope*'s figure ran off the screen); fixed in *Neon Monsoon*, *Night Bloom*, *Phosphor Scope*, *Prism Lattice* and *Twelve Moons*, with their pictures redone, and a test now rejects it.
  - Prefixed noise samplers such as `sampler_pw_noise_lq` must be declared in the shader, or MilkDrop drops the comp shader.
  - MilkDrop `#define`s its shader inputs (`time`, `bass`, `q1`…`q32`, and per stage `rad`, `ang`, `uv`, `uv_orig`, `hue_shader`), so a variable with one of those names does not compile there.
  - `PSVERSION=3` means ps_2_x, not ps_3_0, so there is no dynamic `break`, and loops have to unroll within 512 instructions.
  - With `PSVERSION=4` (ps_3_0) a `break` compiles, but MilkDrop 2 draws that stage black: *Mandelbrot Dive* was black there until its loop lost the early exit. No preset uses `break` now.

  Every preset is compiled the way MilkDrop does it (its header and wrapper, the SDK shader compiler, ps_2_a then ps_2_b) before it is added.
- **Engine: HLSL C-style casts compile.** `(float)k * 0.2`, `(float2)x` and `(int)(a + b)` are valid HLSL and MilkDrop compiles them; our shader translator did not, and the stage was dropped as "not compiled" (found while building a preset). They are now turned into GLSL constructors, binding to the term right after the cast as in HLSL. No preset in the 10,347-file test corpus uses them, so no existing preset changes.
- ***Halo Spectrum* matches MilkDrop 2 [825].** Against MilkDrop 2 with a test tone, some bars in the upper half stood much taller in our engine. A debug preset that blows up the hidden data rows found two causes:
  - Our spectrum's floor in the top bins is slightly higher. The preset's treble weight (up to ×7) turned that floor into bars. The bin layout and the tone peak are the same in both engines.
  - MilkDrop 2 draws the data line about one pixel lower.

  The preset now takes a small floor off the spectrum before weighting, and reads the data row at its centre and one texel either side. Side by side with MilkDrop 2 the ring is now the same, including the tone's own spikes. Why the top-bin floor is higher (8-bit input or analyser dither) is left for a separate engine check (#560).
- **Engine: the comp shader sees the same frame as its blur.** MilkDrop binds `sampler_main` to `m_lpVS[0]` in every preset shader (plugin.cpp:2415-2418, milkdropfs.cpp:3678-3679). When the comp shader runs, that buffer is still the warp's input: the previous finished frame, which is also the frame the blur chain reads. We gave the comp shader the frame just drawn, so `main` and `GetBlur` were one frame apart. On fast motion the glow trailed the shape, and presets that find edges with `main - blur` drew thick coloured rims. Found while building a pop-art preset whose outlines came out much heavier than in MilkDrop 2. In a synthetic test (a disc sliding at constant speed, main in red and blur in green), MilkDrop 2 showed the two on top of each other and we showed green one frame behind; now they line up. On 80 seeded corpus presets against MilkDrop 2, the coarse difference fell from a median of 25.5 to 23.1 (9.9 to 9.3 on the 22 without random or textures), and none of those 22 got clearly worse. A comp shader's picture is now one frame later, as in MilkDrop. Presets without a comp shader still show the current frame (`m_lpVS[1]`, milkdropfs.cpp:3803), and so does the engine with accuracy mode off.
- **Engine: noise textures keep their alpha.** Reading `.w`/`.a` from a noise texture (`tex2D(sampler_pw_noise_lq, p).w`, or `float4 h = tex2D(sampler_noise_hq, p)`) gave 1.0 in our engine; MilkDrop gives the texture's random alpha. A preset that picked a colour per cell from `.w` showed every cell in the same hue next to MilkDrop 2's many hues (measured side by side). Those reads now keep the alpha; the main buffer and blur textures still read 1.0 as before. The corpus still compiles in full (16,346 of 16,346 stages before and after).

### Audio bridge: its own window for everything, mode switch with restart, clock fix [822]

- **The bridge window is the bridge's whole UI.** Three tabs, Status, Sources and Settings, under a header that stays on top. Settings has the bridge name, the pairing secret (show, copy, New Secret with a warning that receivers drop), the port, this computer's addresses with the port and a copy button (for a receiver that has to type the address), the firewall rule, "Start the Bridge at Sign-in" (installed and portable builds; Windows startup list, Linux autostart), "Don't Open the Status Window at Start", and the way out of bridge mode. The panel is still there as "Advanced Settings (Panel)" but is no longer needed. Fields are saved when you leave them, and the window no longer redraws under a field while you type.
- **Start at sign-in uses the Startup folder on Windows.** In a process with the package identity Dynamic Lighting needs, registry writes go to a private copy: measured on `win-unpacked` (running with that identity), the app wrote and read back a `Run` entry that the real registry never had. A shortcut in the user's Startup folder lands in the real folder (measured) and is used instead; turning it off in Task Manager reads as off.
- **Leaving bridge mode from the bridge.** "Back to Normal Mode" turns the setting off, checks that it reached the disk and reopens the app normally. A bridge opened with `--bridge` (its own settings folder) offers "Close Bridge, Open the App" instead: if the normal app is already running it comes to the front, otherwise it opens. A dialog asks first and says how many receivers will fall back to their local input; starting at sign-in is turned off too. The tray menu has the same entries.
- **"Open Audio Bridge Separately"** in the panel starts a bridge next to the running app (its own settings folder, window and tray); if one is running it comes to the front. It works in the portable build too (see below).
- **Fixed: native message boxes crashed the packaged Windows app.** Packaging replaced Electron's exe manifest with the Dynamic Lighting identity manifest, dropping Common Controls v6, the Windows 10 `supportedOS` entries and the DPI setting. Every `dialog.showMessageBox` ("already running" on a second launch, "Back to Normal Mode", "settings not saved") ended the app with 0x80000003. The identity is now merged into Electron's manifest and the result is checked at build time. Measured on the packaged build: the dialogs open, the package identity stays. Releases up to 3.1.5 have this bug.
- **Fixed: opening the portable exe a second time deleted the running copy's files.** The stub unpacks into one fixed temporary folder and deleted it before unpacking and after the app exited; measured, 170 of 177 files went. The stub template is patched before packaging: a folder whose exe is in use is neither deleted nor re-unpacked, and is kept on exit while a copy still runs from it. Measured afterwards: 177 of 177; a separate bridge next to the portable app keeps running after the app quits; restarting into "Audio Bridge Only" works.
- **Taskbar "Audio Bridge" task in the installed build.** With the package identity the taskbar button belongs to the package app and `setUserTasks` writes nothing; the task is now written with the WinRT JumpList API (measured: written under the package's app ID with `--bridge`). Not checked by installing: that it shows on the taskbar, and the installer's Start menu shortcut.
- **"Audio Bridge Only" asks to restart.** Turning it on or off in the panel asks "Restart now?": Restart Now saves, verifies and reopens the app in the new mode; At Next Start keeps it for later. In a bridge opened with `--bridge` the switch is hidden, because the flag decides there.
- **Fixed: frame age and the shared clock were ~100 ms off for a second after connecting (Windows).** The receiver's first clock ping is answered while the bridge starts its capture helper; that one slow round trip (204 ms) set the offset 102 ms wrong until the next ping a second later. The bridge rig read it as a frame age p95 of 105 ms. The first five pings now go 100 ms apart. Windows bridge rig afterwards: frame age p95 2 ms (bridge-only) and 1.5 ms (normal mode), no lost frames.
- **Fixed: the redundancy clock offset could start too high and take ~25 s to settle.** The backup took its first heartbeat sample as the offset and then moved 1 ms per beat; a sample read while the backup was busy right after connecting would linger. For the first eight beats after a (re)connect the offset now goes straight to the best sample, then slews as before.
- **Fixed: Turkish device names counted as untranslated text.** Device and app names come from the system ("Hoparlör" on a Turkish Windows) and are now marked as user text in the shared source picker, so the English self-test no longer fails on them.

### Redundancy overhaul, phase 4: beat sync, OBS fallback, status banner, failover tests and the setup guide [815, 816]

Setup guide in English and Turkish: [docs/REDUNDANCY.md](docs/REDUNDANCY.md), [docs/REDUNDANCY.tr.md](docs/REDUNDANCY.tr.md); the README has a new "Show safety" section.

- **Beat and phase sync.** The primary sends its tempo grid (BPM, the last beat on the wall clock, bar position) with every second heartbeat. A following backup uses it ("Use the Primary's Beat While Following", on by default), so both machines count bars together and the backup's Auto VJ does not start cold after a takeover. The backup's tempo engine now keeps running while it follows (before, Auto VJ's loop returned early and the tempo stopped). The panel shows the primary's tempo and how far the backup's own detection is from the grid. Simulated with 0–15 ms delivery jitter, the grid lands within p95 < 20 ms.
- **OBS / browser source fallback.** "Streaming Page Fallback Addresses" (Redundancy → Connection) lists the other machine's page with its token. The server sends the page a small heartbeat twice a second; after 1.5 s of silence (a dead, hung or unplugged machine: an unplugged cable never closes the socket) the page drops the connection without waiting for the close handshake and moves to the next address, and it returns to the first as soon as that answers. A connection attempt is cut after 1.5 s. The page keeps its last frame and settings. The other machine accepts the page's origin only when it is in its own list. Fallback tokens never reach web clients and are hidden from MCP. Measured in an unthrottled window: on the backup 2.2 s after the primary hung, 2.1 s after it was killed, back on the primary 5.3 s after it resumed. The first version waited three tries and the socket's close and switched after ~5 s, or never when the primary hung.
- **Status banner and alarm.** While a role is on, a banner above every category shows role and state, authority and term, last beat, clock offset, jitter and the audio input, in green, amber or red. Takeover, two masters and a primary that stepped back raise an alarm: the banner flashes until OK, the OS shows a notification, and a short sound plays only if "Play a Sound on Alarm" is on (off by default, so it cannot leak into a monitor mix). The pulse respects reduced motion.
- **Review fixes.** Output authority, the Art-Net witness and loss behaviour, the hand-back moment, the alarm sound and the beat lock now apply while the app runs (they were only read when a link setting changed too; the rig now flips Art-Net to "Always" and back on a running backup). Auto VJ no longer switches the moment authority arrives: its bar counter is held at zero while it may not decide. The archive list and the package manifest behind the status are cached by modification time instead of being read from disk every second. "On the other machine" no longer truncates in the English tiles ("Other machine").
- **Fixed: OSC beats, clock and hits bypassed output authority.** They are sent from the tempo engine and the hit detector, not the meter frame, so phase 3's gate missed them; they are gated too now.
- **Remove Copied Videos.** On the backup, Show Data → Remove Copied Videos rewrites the package manifest without videos and deletes their files; presets and logos stay, a video that is playing is deleted at the next clean-up, and a later pull without videos still completes.
- **Bridge audio on the shared clock.** Each PCM chunk is scheduled at the bridge's timestamp (converted to this machine's clock) plus the latency, through the output timestamp. Two receivers with the same latency play the same sample together (simulated: within 5 ms under 2–60 ms jitter). Late or overlapping chunks are dropped instead of shifting the timeline.
- **`npm run failover` has five scenarios**, two new ones in this phase: a network cut with the socket left open (a TCP proxy that stops forwarding), a hung primary (process suspended with `NtSuspendProcess` / `SIGSTOP`), the peer preview with a real visualizer window, and both machines restarted. `--report=<file>` writes the results as JSON for the two-PC run. Measured on Windows over seven full runs (five back to back, all scenarios passing every time): network-cut takeover 1415–1515 ms with the primary stepping back ~316 ms after the link returns and no alarm; hung-primary takeover 2044–2459 ms; the preview leaves the longest heartbeat gap unchanged; the term survives a double restart. The rig's UDP listener now binds port 0 (a TCP-free number fell into a Windows-reserved range once).
- **Not done (stated in the guide):** a real two-PC LAN run, macOS measurements, packaged jump list / dock / tray checks on macOS and Linux, Opus, a slim standalone bridge, several bridges, and the bridge as a split-brain witness.
### Redundancy overhaul, phase 3: output authority, terms, fencing, hand-back and two-way control [814, 816]

Details and measurements: [docs/REDUNDANCY.md](docs/REDUNDANCY.md).

- **Only the machine with authority drives lights and OSC.** Before, Art-Net, OSC output, OpenRGB and Dynamic Lighting ran on both machines whenever they were on, so a primary and a backup could drive one DMX universe together. Each of them is now "Only with authority" (default) or "Always". The picture, Spout/Syphon and the overlay page are not gated. Art-Net holds its last frame when authority leaves (default) or sends one black frame.
- **Terms.** Every takeover opens a new term, stored in `<userData>/redundancy/term.json`; it never goes down and resets with a new pairing secret. The primary sends its term and authority in every heartbeat; the backup now sends its own beat back. A primary that sees the backup active with a newer term steps back: its gated outputs stop, and Auto VJ, the timeline and Clip Deck make no decisions.
- **Fenced restart.** A primary that starts with the role on sends nothing to gated outputs until it has seen the backup's state, or no backup for twice the loss limit. Measured: a primary restarted while the backup was active sent zero Art-Net packets.
- **Two masters.** When both machines act as authority (equal terms, or the optional Art-Net witness on UDP 6454 sees our universe from another address while this machine sends), both panels and the pre-show check say so in red, and the backup does not take over by itself. The witness also holds automatic takeover when the backup loses the primary's beats but still sees it sending Art-Net.
- **Resync on every return to following**, not only after Release; snapshots carry a revision number. Measured: 164 ms from Release to the backup showing the primary's live scene.
- **Hand back to primary.** On an active backup, with every condition listed (primary beating for 5 s, shows match, clock synced, same version) and a switch moment (now, next scene change, blackout). Measured: 266 ms, no overlap; refused with the condition named when the shows differ.
- **Two-way control and monitoring.** Each machine shows the other's authority, term, state, frame rate, audio level, open outputs and a small preview (two frames a second, at most about 30 KB, only while the section is on screen). Show commands run on the machine with authority and are forwarded otherwise, applied once and acknowledged.
- **Pairing without the secret in the URL.** HMAC challenge in both directions; a backup will not follow a primary that cannot prove the secret. The old `token=` address still works for one release, with a pre-show warning.
- **Pre-show check:** two masters, a fenced primary, a primary that stepped back, old pairing, both machines always sending to one Art-Net universe, and a backup whose Art-Net target differs from the primary's.
- **macOS:** the app holds an App Nap exception while a role is on.
- **Tests.** Unit tests for authority, gates, terms (persistence, never down, reset on a new secret, BOM and broken files), the split-brain rule, the takeover veto, hand-back conditions and moments, the command allow list and de-duplication, the HMAC client against a fake and a real streaming server (wrong secret, fake primary, old primary fallback), the Art-Net witness and black frame, and the pre-show rows. `npm run failover` has a fourth scenario that counts Art-Net packets per sender across takeover, Release, hand-back and a fenced restart.
- **Not done:** the bridge as a third witness (it would tie the optional bridge to redundancy) and a real two-PC network cut (phase 4).
### Show category: a tidier layout and live redundancy statistics [816]

- **One layout for both cards.** The Show category used a separate bordered box for every line, a status box with its icon pressed against the text, and long explanations stacked under each other. Both cards now use the audio bridge card's parts: a status pill, stat tiles, groups with one divider, and "?" help that opens over the card instead of pushing it down.
- **Pre-Show Check:** the overall pill, "4 / 6 passed · 1 warning", the "?" help and "Check Now" sit on one line above the list.
- **Redundancy, live statistics.** The tiles update once a second while the card is open, without redrawing it, so a field being typed in keeps its cursor.
  - On the backup: time since the last beat (coloured against the loss limit), the longest gap (and the primary's own), the beat interval p95, jitter, missed beats (sequence gaps) and beats received, the clock offset with its sample count, and the time in the current state.
  - On the primary: whether the backup is connected and what it is doing, how long it has been connected, the heartbeat interval and beats sent, this machine's longest send delay, and whether the shows match.
- **Groups:** Status, Authority, Connection, Show Data, Show Package, Archives. Long lists (the primary's scenes, copied videos, package files, isolated and conflicting items, archives) are folded with their count in the title. The heartbeat and loss limit fields moved to the Advanced view.
- **Manual takeover is no longer the glowing blue button.** On a following backup the most prominent control was "Take Over", in the primary blue style that glows on hover, and it took control at once without asking. It is now "Take Over Manually" in the warning tone, it says what it does, and it asks first; when the primary is still running it warns that you should only take over if the primary failed or for a rehearsal. "Release" also asks first.
### Redundancy overhaul, phase 1: isolated show, show package, scene parity [812, 816]

- **Panel polish from the Windows test round.**
  - The show package's file list no longer runs into the "Also copy video files" row: the box is laid out as a column with its own spacing, the list scrolls, and the video row sits on its own line. File kinds read "Preset" and "Logo" instead of the raw `preset`/`logo`.
  - "Send Differences to Backup" asks with two lists, "Missing on the backup" and "Different on the backup (the backup keeps its own version)", instead of counting both as missing.
  - With auto takeover paused after a manual hand-back, the backup's status read "waiting for a manual takeover · Auto takeover on hold". It now reads "The primary is not responding · Auto takeover is paused since the manual hand-back: take over manually or re-arm it", and while following, "Auto takeover paused (handed back manually)".
  - The docs say the test count is the runner's total, so environment-dependent skips (0 on one machine, 1 on another) do not change it.
- **Review fixes.**
  - **Fixed: a new package failed while the backup played a copied video.** Measured on Windows: a folder that holds an open file cannot be renamed, and an open file cannot be replaced (EPERM). The swap renamed the whole package folder, so every new package (including the one "Send Differences to Backup" pulls) ended in "Copying stopped" while a copied video was on screen. Files now live in a content-addressed store (`package/store/<hash>/<name>`) and are never moved or overwritten; the swap is a single atomic write of `current/manifest.json`. Unused files are removed after the swap, and a locked one is left for the next swap. Packages installed by the earlier layout keep working. The failover rig now holds the video open during the second package.
  - Unchanged files from the last package are read in place instead of hard-linked. Before, a corrupt earlier file that was downloaded again was written through the shared link into the verified copy.
  - Retrying a locked rename no longer blocks the main process (it used `Atomics.wait`, up to about 0.6 s per rename).
  - A different package no longer deletes a half-downloaded one: the two newest staging folders are kept and can resume.
  - The primary's version was never recorded (the `hello` branch returned before it), so `primary-show.json` always had an empty version.
  - Local show archives are capped at the newest 20.
- **The backup keeps its own show.**
  - Before, everything the backup received from the primary was written into its own settings. That covered the scene, saved scenes, Studio presets, timeline, Clip Deck and Auto VJ. "Send Differences to Backup" also replaced presets and logos with the same ID.
  - Now the primary's copy lives in `<userData>/redundancy/primary-show.json`.
  - The backup's own show is kept in `local-show.json`, and `settings.json` keeps being written from it.
  - Turning the role off puts the local show back exactly as it was. The file is archived as `local-show.restored-<time>.json`, not deleted.
  - **Upgrading:** a machine that already ran as a backup on 3.1.6-beta keeps whatever its settings hold at the first start, as its local show. Nothing is deleted.
- **Importing is per item and confirmed.**
  - Each of the primary's saved scenes has "Import to Local Show". On an ID clash the copy gets a new ID, and existing scenes are never changed.
  - "Send Differences to Backup" no longer writes into the backup's library. The backup pulls the package without video files, and the items stay in the separate area.
- **Fixed: a panel edit after turning the role off could overwrite the backup's show.** Found on Linux. Turning the role off put the local show back into `settings.json`, but the backup's panel kept showing the primary's show. The panel's next edit sent that copy back and wrote the primary's scenes to disk. Now the panel gets the restored show straight away. The same immediate update now happens on takeover, Release, switching the takeover show, and importing a scene while the local show is rendering.
- **Fixed: pulling the same package again hung at 100%.** Found on Linux. When every file was already present from the last copy, no chunk was requested, and the verify-and-install step only ran when a chunk arrived. The pull stayed in "transferring" with every file done and a speed of 0. Now confirming or resuming a pull with nothing missing goes straight to verifying and installing. A unit test and a failover-rig step (a third identical package) cover it.
- **Following the primary no longer blocks the main process on disk writes.** One rig run showed a 750 ms heartbeat gap, half the limit, before Push. It did not reproduce (the largest gap in later runs was 182 ms, also with a cold disk cache), but the follow path did work that could block on a slow disk or under a virus scan: every change of the primary's show was serialized twice, parsed back and written synchronously, and `settings.json` was rewritten even when nothing in it had changed. The copy of the primary's show is now written in the background from the text that was already computed, and only the newest of several queued writes goes to disk. `settings.json` is not rewritten when the text is the same and the file was not changed by someone else.
- **Fixed: a package copied without video files deleted the videos from an earlier package.** Found on Windows, where 2.8 GB disappeared. The swap replaced the whole package folder. Now every verified video in the old copy that the new package does not bring is carried into the new copy and stays in its manifest. This also happens when the primary no longer lists the video. The carry uses a hard link, so nothing is copied or doubled on disk. On a file system without hard links (FAT32, exFAT) it falls back to a copy. If a carry fails, the swap does not happen and the old copy stays. Unchanged files from the last package are also hard-linked now instead of copied. There is no "remove copied videos" action yet, so videos are only removed by deleting `<userData>/redundancy/package` by hand.
- **Fixed: auto takeover took control straight back after a manual Release.** Found on Windows. With the primary still down, "Release" handed control back, and auto takeover took it again at once. After a manual Release, auto takeover is now on hold until the primary is seen alive again or the operator re-arms it. The panel shows "Auto takeover on hold" with a "Re-arm Auto Takeover" button, which asks for confirmation. Manual takeover always works.
- **Local show archives can be restored.** The panel lists the last ten `local-show.restored-<time>.json` archives in every role, with date and size. "Restore" asks for confirmation and archives the current show first, so a restore can be undone. On a backup that is rendering the primary's copy, the restored show becomes the local show without touching the live picture.
- **Videos are listed before you tick the box.** The package offer lists every video by name and size before "Also copy video files" is ticked, and marks the ones already on this machine. Under "Show Data", the backup lists the videos already copied to it, which the primary's copy uses on takeover.
- **"Send Differences to Backup" no longer pauses the heartbeat.** It used to send each logo whole in a single message on the link. On a cold start that held the heartbeat for 1.7 s, against a 0.75 s limit. A backup on this version now reports that it pulls packages, so the primary only sends a short notice and the items arrive in 256 KB chunks. An older backup still gets items one by one, with a yield after each one.
- **Takeover data.**
  - "Show to Use on Takeover" chooses between the primary's copy (the default) and this machine's own show.
  - While in control, the operator can switch between the two.
  - Changing the choice does not reconnect the link.
- **Resync after Release.**
  - While in control, the backup still records what the primary sends.
  - On Release it applies that, then asks the primary for a fresh snapshot and show clock. Before, it kept a stale picture until the primary's next change.
- **Show package.**
  - "Request Package from Primary" builds a versioned manifest with a SHA-256 for each file and a hash for the package.
  - The package holds every user preset, every logo and the video files used by the scenes.
  - The backup lists the contents and asks first. Video files are copied only if you tick them; the size is shown.
  - Files arrive in 256 KB chunks, two at a time on the existing link, each with its own checksum. A corrupt chunk is requested again.
  - The transfer resumes after a dropped connection or a restart, and files that are unchanged since the last package are not downloaded again.
  - Every file is verified before anything is put in place. The swap takes two steps and is retried on the brief file locks that are common on Windows. A swap that fails halfway is rolled back, so the last good copy stays.
  - The panel shows a progress bar, the file list, speed and errors.
  - Nothing from the package is written into the backup's library on its own.
    - Presets and logos the backup does not have stay in the package folder. While the primary's copy is rendering, the windows see them as if they were in the library. They disappear again with the local show or with the role off.
    - Each one has "Add to Library", with its own confirmation.
    - An item with the same ID but different content is listed as a conflict, the local one is kept, and "Use the Primary's" replaces it after confirmation.
  - Video files stay in the package, and the primary's scene is mapped to those copies. A file that already exists at the same path on the backup is left as it is.
- **MilkDrop parity.**
  - The primary's MilkDrop choice now also carries the preset's content hash and the moment of the switch. The seed already travelled with it (#585).
  - The backup lists a preset that is missing or different there, under "The picture may differ from the primary".
  - A preset picked by hand is checked too. Found on Windows: the warning only came from auto-pick, so a primary-only preset picked by hand gave no warning. The scene copy carries the preset's ID and source, and the backup compares them with its own library and the separate area. That covers the panel, Clip Deck, Auto VJ and the timeline, which all write the scene's MilkDrop preset or a MilkDrop layer's preset. Built-in presets ship with the app and are not checked. The list says whether each entry came from auto-pick or a manual pick.
  - The auto-pick check needs the primary's visualizer window (or Spout/Syphon window, or panel preview) to be open, because the leader window sends the choice. The manual check works from the scene copy alone. The panel notes this.
  - Found in the code:
    - When the chosen preset is missing on the backup, its windows silently stay on the previous preset.
    - Per-frame equations follow each machine's own audio.
    - The `rand_frame` input and one random rotation source are drawn per frame.
    - Frame rate and feedback history differ per machine.
  - The leader now sends the moment its transition started. A window or backup that starts the same transition late moves its blend forward to that moment, once and never backwards, so both screens finish the blend together. On the backup the moment is converted from the primary's clock. Web pages on other machines do not get it, since their clock is separate.
  - Fixed: the backup's windows got the primary's wall-clock `at` field, which overwrote the window's own receive time. Following then never timed out after 1.5 s.
  - Hash, seed and timing remove the first cause. Audio is phase 2 (#813); the rest is documented in #812.
- **Tests.**
  - New unit tests for the manifest, safe names (path traversal, absolute paths, backslashes, case-insensitive collisions), chunk checksums, resume, verification, the atomic swap with Windows rename failures, media confirmation, isolation and restore, scene import, media mapping, the takeover data choice, MilkDrop parity, the isolated package layer, per-item import and blend alignment.
  - `npm run failover` now also checks that the backup's `settings.json` keeps its own scenes and that the copy lands in `primary-show.json`. It copies a show package with a video and a conflicting preset, and takes over with the local show and then turns the role off. It checks that pushed and packaged items stay out of the backup's library until each one is imported. It also turns the role off while the primary's copy is rendering, makes a panel edit, and checks that `settings.json` keeps the backup's own show. It copies a second package without videos and checks that the earlier video stays and was listed before the box was ticked. It releases control with the primary down and checks that auto takeover waits past the 5 s start grace until it is re-armed. It also restores a local show archive.

### Audio bridge, redundancy overhaul phase 2 [813, 816]

- **Review fixes.** The bridge refuses a 17th connection that has not paired yet (each one held a buffer and a 5 s timer), and a packet split over many TCP segments (cover art up to 400 KB) is joined once instead of being copied again on every segment.
- **Fixed: starting the audio bridge a second time crashed on Windows** with "ReferenceError: Cannot access 'instanceTimer' before initialization". The second copy called `app.quit()` while the main process was still loading, and Electron ran the `will-quit` cleanup at once, before the state it touches existed. The second copy now exits right away (the running bridge brings its status window to the front), and the `will-quit` cleanup is skipped until the main process has fully loaded, which also covers a quit signal during startup.
- **What it solves.** Every machine captured its own device. A backup without the same signal drew a flat picture. Now one machine's capture can go to the others, so the primary and the backup analyse the same signal. Details, the wire format and the measurements are in [docs/AUDIO-BRIDGE.md](docs/AUDIO-BRIDGE.md).
- **Inside the app, not a separate program.**
  - "Send This Machine's Audio to the Bridge" works in normal mode, so the primary can be the bridge itself. It uses the same capture, so nothing competes for the device.
  - `--bridge`, or Settings → "Audio Bridge Only", starts without visual output or visualizer windows, without lighting, streaming or OSC, and without hardware acceleration. It opens a small status window and sits in the system tray.
  - **Status window:** broadcasting or stopped, the source, a live level meter with bands, BPM and beats, the connected receivers (name, address, round trip, frame age, lost frames, failed pairings), now playing and errors (device missing, capture failed, port busy). Buttons open the bridge settings, stop or start the bridge, or quit. Closing it keeps the bridge in the tray; the tray reopens it. Without a tray (stock GNOME) the window is the main UI. `--bridge --hidden`, or "Do Not Open the Status Window at Start", starts without it.
  - **Live panel tiles:** the Audio Bridge card's level, bands and beat tiles update about 6 times a second while the panel is visible (bridge-only mode included); only those tiles redraw.
  - **Theme:** an open status window follows theme changes live.
  - **Playback:** drift control trims the buffer back to the target in small steps; playback starts at 30 % volume; the panel warns when the output may echo into this machine's capture.
  - **App sources follow the app:** a ticked app that quits shows "closed, waiting" within about 2 s and its stale capture helper stops; when the app starts again it is reattached by name on its new process, without unticking. Other sources keep running.
  - **Now Playing card:** the status window redraws on every track or cover change instead of lagging one update behind.
  - **Source switch:** the bridge tells receivers before it restarts its capture, so they do not briefly fall back.
  - **Where:** the Audio Bridge card is in the Audio category below Audio Sources and Audio Analysis, not behind Advanced. The settings search finds it ("köprü", "bridge"), Settings → App links to it, and "Open Bridge Settings" in the status window or tray opens the panel on it.
  - **Sources:** the status window and the bridge's settings card show the app's own Audio Sources picker (Active Sources, Application Audio with live meters, Refresh Devices). Any mix of outputs (loopback), inputs and single apps is captured and mixed by the same capture helper, and the bridge sends and analyses that mix. Single-app capture: WASAPI process loopback on Windows build 20348+, ScreenCaptureKit on macOS 13+ (Screen Recording permission), the app's PulseAudio/PipeWire stream on Linux. Switching is live and receivers stay connected. If one source is missing or fails, the others keep running and the window names it. In bridge-only mode the list is kept in `<userData>/bridge`. The default is still the single default output.
  - `--bridge` keeps its settings in `<userData>/bridge`, so it can run next to the normal app on the same machine.
  - Bridge-only mode is a single instance. Starting it again brings the running bridge's status window to the front instead of a second bridge.
  - On Windows the installer adds a "CAYADEV Visualizer Audio Bridge" Start menu shortcut, and the taskbar jump list has "Audio Bridge" (installed build). The Linux deb adds an "Audio Bridge" action to the launcher. On macOS use `open -n -a "CAYADEV Visualizer" --args --bridge`, and on the AppImage pass `--bridge`.
- **What is sent.**
  - The capture helper's own analysis frame (spectrum and stereo waveform), about 64 a second on Windows and 69 on Linux (3.7-4 Mbit/s), plus the now-playing track.
  - The bridge's own analysis: bands, level and peak, beat, BPM and confidence, beat phase, onsets. Beat and BPM use the visualizer's tempo engine. It goes out every second frame and right away on a beat.
  - Every frame, analysis packet, audio chunk and track update carries a format version and the bridge's timestamp. The receiver converts it to its own clock with the measured offset, and with redundancy on, onto the shared show clock, so the same bridge moment has the same time on the primary and the backup.
  - It runs on its own TCP socket (8741), not on the redundancy link.
  - **Listenable audio:** "Play the Bridge's Audio on This Machine" plays the bridge's sound (16-bit stereo PCM, about 1.5 Mbit/s) on a chosen output, with a volume and a jitter buffer. Only receivers that ask for it get it.
  - The bridge's own now-playing track is sent: title, artist, album, duration, position, play state and the cover. The cover is shrunk to 512 px JPEG and sent once per track and receiver, keyed by its hash. Every field is optional. On a receiver whose input is the bridge, the now-playing card, text layers and lyrics use it. The media session is read on Windows (SMTC) only; on macOS and Linux the bridge sends no track and the status window says why, and the rest of the bridge is unaffected.
- **Pairing and discovery.**
  - The pairing secret is checked in both directions with HMAC, and is never sent.
  - The bridge sends a signed UDP beacon on 8742. With the address field empty, the receiver connects to the first bridge whose signature matches. It needs no mDNS daemon. A typed address still works.
  - A bridge with several network adapters (Hyper-V, WSL, VPN) is listed once. While connected the receiver keeps its address; it switches only after a failure, preferring an address on its own subnet, and closes the old socket. Before, every new beacon address caused a reconnect about once a second on Windows.
  - After a drop the receiver retries within 250 ms to 1 s (no more 5 s back-off), and a beacon from its bridge triggers an immediate reconnect.
- **"Audio Input: Network Bridge".**
  - The bridge's frames replace local capture, and local capture stops.
  - If the bridge is silent for 600 ms, the input falls back to the local device. It returns after 0.5 s of steady frames; after an 8 s outage the input is back on the bridge about 1 s after the bridge restarts.
  - The panel's capture label switches to the bridge when the input does, and a late local "started" message no longer overwrites it.
  - "Fallback Input" chooses what is captured meanwhile: the normal input, or another device such as a mixer split.
  - The pre-show check shows the active source, with the bridge's name or the fallback device.
  - While the input is on the bridge, the bridge's track is used everywhere: outputs, panel, OSC track title, the stream page and MCP.
  - The panel shows the round trip, the clock offset, the frame age and lost frames.
- **Measured** with `npm run bridge-rig`, on Linux with PulseAudio:
  - Discovery took about 1 s.
  - The p95 frame age on one host was 2.5–4.5 ms.
  - The fallback came 610–680 ms after the bridge was killed.
  - The bridge-only process used about 5 % of one core and about 610 MB RSS across all processes while capturing, about 400 MB hidden and idle. Closing the status window frees its renderer.
- **Settings card redesign.** The Audio Bridge card is grouped into Mode, Connection and Status, with the same switches, rows and separators as the other cards, a status pill and stat tiles. Long explanations moved into "?" hints. The bridge source is one clear picker (default output, outputs, inputs) instead of a tickbox list.
- **Self-test.** `npm run smoke:bridge` checks that bridge-only mode opens only the status window and no visual output, has hardware acceleration off, has a tray and listens. It also checks that the status window and the panel's Audio Bridge section are fully translated in English.
- **Tests.** New tests for the bridge's analysis (bands, level, a 120 BPM beat train), analysis and track timestamps across a 5 s clock skew, the fallback device, the single-instance lock, the frame encoder, packets, pairing (wrong secret, fake bridge), real TCP transfer and reconnect, clock offset, beacon signing, broadcast addresses, a real UDP beacon, the fallback state machine, the pre-show row and the panel's TR/EN strings, a beacon heard from several addresses, the receiver keeping its address and rotating on failure, the capped back-off, PCM packets and the helper's mixed frame/PCM stream, the audio player's scheduler, the early-quit guard, and the deb desktop action. `npm run bridge-sources-rig` checks two synthetic sources (440 Hz and 1000 Hz) plus a missing one, in the helper's mix and end to end. The bridge rig now waits 8 s before relaunching the bridge and fails if the input is not back within 6 s, cold start included.

### Broadcast layout editor

- **Live and export parity [539].** `npm run parity` opens the real visualizer page and draws
  each case once with a fixed audio frame and clock. It composites the same layer canvases
  through the live CSS path and through the export canvas path, then compares the two pictures
  pixel by pixel. There are 23 cases: broadcast layouts, opacity and transforms, every blend
  mode, a mask, the A/B crossfade and reveals caught midway. All now match, with a mean
  difference of at most 0.08 levels. The check and the review behind it found these
  differences, now fixed:
  - **Additive blend.** A layer set to "add" used `screen` live and real addition in export, so
    the video was visibly brighter: 13.5% of pixels were off by more than 8 levels. Live now uses
    `plus-lighter`, which is the same addition.
  - **Video layers in export.** The exporter never loaded the media layer, so a video background
    was simply missing from the exported video. Each export frame now seeks the video to that
    frame's time and waits for it to decode, looping as it does live. A camera is a live source,
    so it stays empty in export; the export panel says so when the scene has one. The export
    smoke test now renders a video whose frames carry their own number and checks every frame.
  - The export page's content policy also blocked video, and a queued scene's video was refused
    by the media protocol when that scene was not the current one.
  - **Now-playing timing.** The card's entrance and its "show on change" envelope followed the
    wall clock, so in export they depended on render speed. They now follow the frame clock.
  - **Text placeholders.** The exporter did not load the dictionary, so the "ARTIST NAME"
    placeholder stayed in Turkish in an English interface.
  - **Wipe edge.** The reveal wipe snaps to whole pixels on both paths.
  - A test now checks that every script drawn on the live page is also loaded by the exporter
    and the overlay. Each live-only script is listed with its reason.
- **Reveal animations per element [537].** In the Layout Editor every element can arrive at the
  start of the video with a fade, a slide (up, down, left or right), a zoom or a wipe. Each has
  its own duration, delay and easing, so the elements do not all land at once.
  - "Stagger" gives the elements rising delays in list order. "Play Reveal" plays them again
    live.
  - Reveals are applied where the layers are composited, so the live output, the overlay and
    video export use the same calculation. In export the clock starts at frame 0.
  - An element plays its reveal when it first appears: at the start of an export, when a scene
    loads, or after "Play Reveal". An element that stays across a scene change does not play
    again. The text and now-playing entrance that plays on a content change still plays; the
    reveal is applied once on top of it.
  - While a layer is still revealing, it no longer hides the layers beneath it.
  - Layout files carry the reveal. An older file leaves the existing reveal as it is.
  - Fixed: without the layer stack, a logo dragged in the Layout Editor jumped back. The
    position was written to a copy that was rebuilt on the next update.
  - Fixed: in English the "wipe" entrance of text and the now-playing card was labelled "Pitch".
- **Logo swapping [535].** A logo layer can cycle through images picked from the logo library:
  every N seconds, every N bars, on a bass hit or at random intervals. It crossfades or cuts,
  and it is off by default.
  - The order is the same live and in video export.
    - The seconds and bars rules follow the clock. The bars rule takes its tempo from the
      settings: the timeline when it is on, otherwise the locked tempo, otherwise 120 BPM.
    - Random intervals come from a fixed seed, never from `Math.random`.
    - The bass rule follows the kick detector and restarts when export starts over.
  - The exporter now loads every layer logo, swap images included, before the first frame. A
    library logo used to arrive a few frames late.
  - It works in the layer stack, which is what broadcast layouts use. Animated GIFs swap as
    their first frame.
- **Text styles and metadata binding [536].**
  - The Layout Editor offers five restrained broadcast styles for text layers and the now-playing
    card: Clean, Lower Third (condensed type), Label, Bold Screen and Thin. A style sets the
    typeface, weight, outline, shadow and, on the card, capitals. It never changes colour. When
    you change a value by hand, the style shows as "Custom".
  - A text layer's source can be fixed text or the now-playing title, artist or both. Track
    details typed on the text card stay as the fallback when the system reports nothing.
  - Capitals now follow the track's language. They always used the Turkish rule, so an English
    "Mind" became "MİND". Now Turkish letters get the Turkish rule and everything else the
    general one.
- **Layouts as files [538].** "Export Layout" and "Import Layout" in the Layout Editor.
  - A layout file holds the scene's bars, now-playing card, text and logo, in order: each layer's
    name, blend, opacity and group, and the element's own settings.
  - It does not hold your content: the logo image and its library entry, track details you
    typed, and lyric text all stay out. So the file opens on another installation with that
    installation's logo.
  - Importing asks first. It then updates the same kinds of element in the scene, in order, and
    adds any that are missing. Everything else in the scene stays as it was.
  - The file is checked: wrong type, wrong version and empty files are refused. Keys such as
    `__proto__` are dropped, and depth and size are limited.
- **Layout editor [534].** The grid button above the live preview opens the preview large,
  framed as 16:9, 9:16 or 1:1.
  - Drag the bars, the now-playing card, a text layer or the logo. They snap to the frame's edges
    and centre, to the safe areas and to each other. Hold Alt to place freely.
  - Arrow keys move the selected element; with Shift the step is ten times larger. The numeric
    fields take exact values.
  - The values land in each element's own settings, so the other cards show the same numbers.
    The output is drawn from the same settings as the preview.
  - It is the same preview, not a second renderer.
  - The self-test opens the editor and checks that every control in it has a name and that the
    preview returns to its place.
- **Groundwork [534].**
  - Bars, text, the now-playing card and the logo report the box they actually draw, in their
    rest pose, without the entrance animation or the audio pulse.
  - Safe areas follow SMPTE ST 2046-1 and EBU R 95: 93% action-safe and 90% title-safe.
  - Snapping uses the frame's edges and centre, the safe areas and the other elements' edges and
    centres.

### Redundancy

- **Show category.** The admin panel has a new category, Show, between Output and Control. It
  holds what keeps a show running rather than where the picture goes: Pre-show Check first,
  then Redundancy.
- **Primary and backup machines [542, 546, 547].** Show → Redundancy sets this machine's role.
  - **Backup.** It connects to the primary and renders the same picture the whole time as a hot
    standby. When the primary stops, it takes over, automatically or on command, chosen in
    advance. Taking over switches who makes decisions, so the backup's screen never goes black.
    Your video switcher decides which output the audience sees.
  - **What is copied.** Only the picture and the show: the scene and its layers, saved scenes,
    the timeline, the Clip Deck, Auto VJ settings and the MilkDrop library's ratings. Audio
    device, displays, ports, lighting, mapping, export and MCP settings stay on each machine;
    `src/shared/show-keys.js` holds the one list.
  - **While following.** The backup's Auto VJ makes no picks, its MilkDrop windows take the
    primary's preset choices, and a scene change made on the backup is overwritten by the
    primary's next change. A backup that has taken over keeps control, even when the primary
    returns, until you release it, so the show is not shaken twice.
  - **How the link works.** The backup connects to the primary's streaming server as its own
    client kind. It always needs a pairing secret of at least 16 characters, even when the
    overlay needs no token, and it never receives overlay traffic. If the streaming output is
    off, the primary opens the server for the backup only, with no overlay pages and no tokens.
    The secret never reaches web clients and MCP cannot change any redundancy setting.
  - **Two signals of a failure, measured apart.**
    - When the primary process ends, the operating system closes the connection. The backup then
      decides within 300 ms, or three heartbeats if that is longer, and reconnects first in case
      the primary only restarted its server.
    - When the connection stays open but heartbeats stop, the full threshold applies (1.5 s by
      default). A primary's main thread was measured stalling 0.2–0.7 s on a scene change; a
      600 ms threshold took over while the primary was alive.
    - A backup started while the primary is down takes over after a start-up grace of at least
      5 s.
  - **Taking over by hand.** "Take Over" and "Release" are buttons in the panel and controller
    actions (MIDI or OSC), so an operator can force it without touching the network setup.
  - **`npm run failover`** starts a real primary and backup with separate profiles and ports.
    It changes the scene on the primary and checks that the backup follows. Then it kills only
    the primary process tree it started, and measures the takeover. Automatic takeover came in
    352–425 ms over three runs, on the scene the primary was showing. Manual mode reported the
    loss in 405–462 ms, waited, and took over on command.
- **Frame sync across the app's own windows [543].** Every output window now computes its
  time from one shared session clock and the vsync timestamp of the frame, not from the moment
  that window opened.
  - **What it fixes.** Windows on one machine already advance on the same vsync: Chromium ties
    them to the primary display. But each counted time from its own opening. Animation phase,
    logo-swap order and modulation were therefore off between screens by as much as the windows'
    opening times differed.
  - **Measured on two displays over 4 s (241 frames):** 187–196 frames fell on the same vsync
    within 1 ms. On those frames the time of the two windows now differs by 0 ms (median) and
    at most 0.1 ms; before, by the windows' opening gap of 49–53 ms.
  - **A lost message, also fixed.** The shared clock was sent as soon as a window loaded, before
    the window had set up its listener, so it was often lost. That is why both windows still
    differed by 53 ms in the first measurement. A window now asks for it once its listener is in
    place. This also applies to the backup's modulation phase from #544.
  - **No jumps on a live output.**
    - A new output window receives the shared clock as it is created, so its first frame
      already uses it. A clock arriving a few frames late made the time jump forward by the
      app's uptime, and a reveal could finish before it was seen. Checked: an output opened
      25 s after start played its reveal from 0 to 1.
    - A backup that has taken over keeps its clock when the primary comes back. A restarted
      primary has a new session start, which used to step the backup's time backward on air.
      The new start is adopted only when the backup is following again. `npm run failover`
      now relaunches the primary after the takeover: the backup's clock stayed the same and
      it kept control.
    - A reveal keeps its progress when the clock jumps either way, for example after a long
      pause in silence. Before, a backward jump replayed it and a forward jump cut it short.
  - **Long uptimes.** Time now grows with the app's uptime rather than the window's. A
    machine left running for a week hands shaders a time whose 32-bit step is about 0.06 s;
    restart the app between long installations.
  - **Hardware genlock is not included.** Sync cards (such as NVIDIA Quadro Sync or AMD FirePro
    S400) have no interface that Chromium exposes, and none was available to test. Between two
    machines, frames line up only as closely as the two displays' refresh clocks; the shared time
    still keeps the content in step.
- **Pre-show check [545].** Show → Pre-show Check shows on one page whether the rig is
  ready, refreshing every 3 s while it is open:
  - every display selected for output is connected;
  - each output window holds its target frame rate: the display's refresh rate, or the frame
    cap if one is set. On Windows the primary display's refresh also counts, because Chromium
    ties every window to it;
  - audio frames are arriving and are not silent;
  - every video file, logo-library item and user preset the scene and the saved scenes refer to
    is present;
  - the backup is connected and the shows match (or, on the backup, that it follows the
    primary);
  - at least 2 GB is free for settings, temporary files and video export.

  A graphics card's load cannot be read on every system. The page measures what is: whether
  each output keeps its frame rate. Output windows now report their drawn frame rate with the
  level meter. Checked in an isolated profile: with no output open the page warns; with one
  output open it shows 75 / 75 fps and audio arriving.

  Rows with details open on click:
  - **Outputs.** Each output is listed with its display, refresh rate and measured frame rate.
    - A window still in its first second of measuring shows "measuring". It used to report
      0 / 60 fps and warn.
    - A window that stops reporting is flagged as not drawing; it may be minimised or covered.
  - **Shared rate.** On Windows, every output window draws at one rate: the slowest of the
    primary display and the open outputs. Measured with a 75 Hz primary, a 60 Hz and a
    165 Hz display, rAF per window:

    | Open outputs | Rate per window |
    |---|---|
    | 165 Hz only | 75 |
    | 75 Hz primary + 165 Hz | 75, 75 |
    | 60 Hz + 165 Hz | 60, 60 |
    | 75 Hz primary + 60 Hz | 60, 60 |

    - The check now uses this shared rate as the target. Before, a 165 Hz output running at
      60 next to a 60 Hz output was reported as "below target", as if the graphics card could
      not keep up.
    - A row names the display setting the rate and suggests a fix: close or move the slow
      output, or try making the fast display the main one if the primary limits it.
    - `--disable-frame-rate-limit` lifts the limit only by dropping vsync, giving 533–629 fps
      unaligned to the display, so it is not used.
    - Making the faster display primary was not tested here.
  - **Missing files.** Each item shows its type, reason and full path, and where it is used:
    live scene or saved scene by name, layer number and name, and field.
    - A file missing only from a saved scene is now a warning instead of making the whole rig
      "not ready".
    - Fixes ask for confirmation first:
      - locate a moved video, which switches every reference to it;
      - show the file or folder;
      - remove the reference from every scene.
  - **No lost cursor.** The page refreshes every 3 s, and Redundancy is on the same page.
    While a field outside the check has focus, a refresh waits until you leave the field.
    Before, typing an address lost the cursor whenever the result changed.
- **Presets saved with a BOM load.** A preset file starting with a UTF-8 byte order mark, as
  PowerShell and Notepad write it, was skipped as unreadable. The pre-show check then reported
  it missing although it was on disk. JSON import from a file picker had the same problem.
- **The backup keeps the primary's time [544].**
  - **Clock offset.** The backup estimates the difference between the two machines' clocks from
    the heartbeats. It takes the smallest "arrived minus sent" over the last 10 s: a stalled
    backup inflates samples and the minimum discards them, while a stalled primary does not
    matter, because heartbeats are stamped when sent. The first estimate is applied directly.
    After that, corrections slew by at most 1 ms per heartbeat, so a clock adjustment on either
    machine never makes the picture jump.
  - **Timeline.** The primary's timeline transport (play, pause, seek, loop) reaches the backup.
    Its moment is converted to the backup's clock, then given to the backup's windows and
    timeline panel. After a takeover, the backup's timeline carries on from the same point.
  - **Modulation.** While redundancy is on, both machines count LFOs, random sources, the time
    source and beat phase from the primary's session start, so they are in the same phase.
    Windows on one machine now share that phase too. Since #543 this shared clock is also used
    with redundancy off, for every output window. The count runs from the session start, not
    Unix time: shaders receive time as 32-bit floats, which at 1.7 billion seconds advance in
    64-second steps.
  - **Measured by `npm run failover`** on one computer, with the timeline playing on the primary
    and 40 paired readings: the backup's panel was within 0 ms (median) and 1 ms (p95). Between
    two computers the accuracy is bounded by the network's one-way delay, which this rig cannot
    measure.
- **Both machines can prove they run the same show [541].**
  - **The comparison.** On the primary, Redundancy shows a show comparison: a hash of each
    machine's inventory, then the differences, each named.
  - **What the inventory covers:** the app version, every replicated setting, every user preset
    (Studio and MilkDrop), every logo-library item and every video file the scenes use. Logos and
    videos are compared by content, not by path.
  - **When it runs:** when the backup connects, after any preset or setting change, and on
    "Compare".
  - **Sending differences.** "Send Differences to Backup" lists what will change and asks first.
    It then sends the presets and logos, which keep their IDs (the scenes refer to them by ID),
    and checks again. Video files are reported but not sent: gigabytes on the connection that
    carries the heartbeat would cause the very failover they are meant to prevent.
  - **Large libraries.** Preset fingerprints are cached and computed 200 at a time, so a
    10,000-preset MilkDrop library does not stall the heartbeat. The backup sends its inventory
    in parts, because a client message is capped at 256 KB.
  - **Pushed items are checked like imports.** A received logo goes through the same checks as an
    import: type, size and image signature.
  - **A setting deleted on the primary is now deleted on the backup too.** JSON drops undefined
    values, so a removed key used to linger.
  - `npm run failover` now seeds a logo and a preset that only the primary has. The comparison
    must report exactly those two, with no setting differences. After the push, both hashes must
    be equal and the backup must have both items. All of this passes, and takeover in the same
    run came in 361 ms.

### Control panel

- **Readability and accessibility [864].** People could not read parts of the 3.1.5 panel. A scan
  of every category found 406 of 1514 visible texts below 11 px (8.5–10.5 px). The worst case was
  the colour template names, at 10 px in secondary grey under each swatch, and the self-test's
  contrast scan had skipped them.
  - **No text below 11 px.** The 62 smaller sizes in the panel's stylesheets are now 11 px, as
    are the timeline and mapping canvas labels (10 px), and template names are 11.5 px in the body
    text colour. The same scan now finds none. Nothing is
    clipped at 1100×760 that was not clipped before.
  - **Interface Size** (Settings → Application → Accessibility): 90, 100, 110, 125 or 150%, and
    <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>−</kbd> / <kbd>0</kbd> (<kbd>Cmd</kbd> on macOS) from
    anywhere in the panel. The shortcuts read the typed character, so Ctrl − shrinks on a Turkish
    keyboard too, where that key sits in the US = position. It is the window's own zoom, so layout, canvas clicks and menus scale
    together. It applies to the panel and the audio bridge window only: at 125% the panel reported
    a device pixel ratio of 1.25 while an open visualizer stayed at 1. The size survives a theme
    change and a reload, and the shortcut saves it, so the panel's next update cannot undo it.
  - **Reduce Motion** turns off the panel's slides, fades and blinking. The operating system's
    "turn off animations" setting does the same without the switch. The visualizer is not affected.
  - **Device default follows high contrast.** When the system asks for more contrast (Windows
    contrast themes, macOS Increase Contrast), Device default switches to High Contrast, live.
  - **Windows contrast themes.** These replace every colour with the system's and remove
    gradients. Switches, the selected button, slider thumbs and level meters were drawn only with
    background colour, so they disappeared. They now use the system highlight colour, and theme
    previews and your own colours keep theirs.
  - Checked by emulating `prefers-contrast`, `forced-colors` and `prefers-reduced-motion`; Windows
    display settings were not changed. Settings → Reset to Defaults keeps all three settings. The
    self-test fails on any visible text below 11 px. It now measures template names too, and finds
    no text below the contrast threshold in any of the seven themes (3554 texts).
- **Interface themes [770].** Settings → Application → Interface Theme offers Device default,
  which is the default, and seven themes:
  - CaYaDev, the existing look;
  - Dark, a neutral graphite;
  - Light;
  - High Contrast, black with yellow, held to WCAG AAA (7:1 for text);
  - Midnight, Sepia and Neon.

  Device default follows the operating system's light or dark preference and switches live: a
  dark system shows Dark, a light one shows Light. If you never chose a theme, the panel follows
  your system from this version on. A theme you picked is kept.
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
- **Screen readers and keyboards [777].**
  - Chromium's accessibility tree showed 139 controls without a name: 54 sliders, 53 switches,
    21 lists and some number and text boxes. A screen reader said only "slider". The setting's
    label sat beside the control but was not tied to it.
  - Each row's label text is now linked to its controls. The "reset to default" button inside the
    label stays out of the name. The name follows the language, because the linked text is the
    same node the translation updates.
  - A few controls with their own layout got a name of their own: the A/B crossfader, the Smart
    Silence Filter switch, the MCP port, and the timeline's BPM, beats-per-bar and snapping
    controls.
  - Pressing Tab through the panel reached 606 elements. On 68 of them focus could not be seen:
    - sliders, which removed the outline and changed only on mouse hover;
    - the export and update lists, where an inline border overrode the focus style;
    - the lighting picker.

    All of them now show focus.
  - The self-test reads the accessibility tree in every category with folds open and walks
    every category with real Tab presses. It fails on any control without a name or any
    focusable element whose look does not change on focus. In the self-test's panel that is
    872 named controls and 595 focusable elements.
- **The self-test scans a populated panel [777].**
  - The self-test's settings had no saved scenes, no clip cells with a preview and no slot without
    a source. So the untranslated-text scan and the contrast audit never drew those screens. The
    selected scene's 3.9:1 label above was found by hand.
  - The self-test now adds representative content to the panel in memory:
    - three saved scenes (white, black and gradient backgrounds) and a selected one that changes
      nothing;
    - clip slots that reference them;
    - a white image, white and black colour slots, and a slot with no source.
  - It also opens every fold, and puts the panel back afterwards.
  - It counts what it actually scanned and fails if the selected row, four preview cells or the
    sourceless slot were not drawn. On the first run they were not: an earlier step leaves the
    deck at 2×2.
  - Each theme now measures about 3,040 texts, with none below the threshold.
- **Two labels were unreadable in every theme.** The empty side of the A/B crossfader and the
  "built-in" tag in Studio's list were dimmed with opacity to 2.9:1 and 3.7:1. They now use the
  secondary text colour. The decorative "·" separators in status lines are hidden from screen
  readers.

### Now playing

- **Capitals follow the track's language.** The card's capitals option always used the Turkish
  rule, so an English "Mind" became "MİND". Text with Turkish letters gets the Turkish rule,
  and everything else gets the general one.

### Video export

- **Exports match the live picture [539].** The pixel comparison of the live window against the
  export path (`npm run parity`, under "Broadcast layout editor" above) found these differences.
  All are fixed.
  - **Video layers were missing.** The exporter never loaded the media layer, so a video
    background was simply absent from the exported video. Each export frame now seeks the video
    to that frame's time and waits for it to decode, looping as it does live. A camera is a live
    source, so it stays empty in export; the export panel says so when the scene has one. The
    export page's content policy also blocked video. A queued scene's video was also refused by
    the media protocol when that scene was not the current one.
  - **Video layers export fast.** In an ordinary video, keyframes come seconds apart, so each
    seek decoded forward from the last one: about 150 ms per frame. A 20 s 1080p export took 98 s
    instead of 8 s. Before the export starts, each video now gets a temporary copy in which every
    frame is a keyframe. The copy is cut to the export length and scaled down to the output when
    the source is larger, and it is deleted when the export ends. The same export now takes 11 s
    (20 s at 60 fps, which took 195 s before), and two runs give identical frames. Videos with
    transparency keep the original file, because H.264 has no alpha; they export correctly but
    slowly. If a frame of a video cannot be read, the export stops with a message instead of
    drawing whatever frame happens to be current.
  - **Additive blend.** A layer set to "add" used `screen` live and real addition in export, so
    the video was visibly brighter: 13.5% of pixels were off by more than 8 levels. Live now uses
    `plus-lighter`, which is the same addition.
  - **Now-playing timing.** The card's entrance and its "show on change" envelope followed the
    wall clock, so in export they depended on render speed. They now follow the frame clock.
  - **Text placeholders.** The exporter did not load the dictionary, so the "ARTIST NAME"
    placeholder stayed in Turkish in an English interface.
  - The export smoke test now renders a video whose frames carry their own number and checks
    every exported frame. A test checks that every script drawn on the live page is also loaded
    by the exporter and the overlay.
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
- **Exporting right after a cancel works [767].** The cancelled job's ffmpeg exited late and closed
  the new export's render window ("The render window could not be loaded"). Every ffmpeg and window
  handler is now bound to its own job.
- **Wrong export settings are refused, not replaced [767].** `sv_start_export` with `8k` or 144 fps
  quietly exported 1080p60. It now answers with the allowed values. The panel still falls back to
  defaults for stale saved values.
- **Timeline-follow recording set over MCP or a settings file takes effect at once [767].** Before,
  it waited until the Output card was drawn.
- **English fixes [767].** The queue heading said "Tail", and export errors, MCP export replies and
  some toasts were in Turkish.

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
- **Linux: two apps that share one program are separate rows [767].** Two `pacat` clients showed as
  one app with two processes, and capturing it took both. Streams are told apart by the stream's
  application name, so each is its own row. A plain key saved earlier still captures every stream of
  that program.
- **Linux: the app quits on SIGTERM [767].** Chromium's own handler closed the windows. With "confirm
  before closing" on, the close dialog then blocked and the process stayed alive. SIGTERM, SIGINT and
  SIGHUP now skip the dialog, stop the queue and the export, and exit within 5 seconds. A second
  signal exits at once.

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
- **Every write tool applies its input or says why not [768].**
  - Parameters can be an object or a JSON string. Invalid JSON, arrays, `null` and keys such as
    `__proto__` are errors.
  - `enabled` accepts `true`/`false` or `"true"`/`"false"`. `0` and `"yes"` are errors.
  - A call whose arguments are all unknown is refused, and the error lists the arguments the tool
    takes.
  - Replies say `changed: true/false`. A call that changes nothing is not saved or broadcast.
  - Setting tools return the stored values (`applied`).
- **GLOBAL and LAYER effect tools are named apart [768].** Every effect tool's description, in
  English and Turkish, starts with `GLOBAL:` or `LAYER:` and names the matching tool of the other
  family. `sv_set_layer_settings` refuses `postfx` and points to the layer effect tools. A stray
  `postfx` inside a layer's settings is dropped on load and reported once.
- **A compact tool list for small models [768].** "Compact tool list" on the MCP card (setting
  `mcp.toolProfile`) lists 27 core tools with one-sentence descriptions. Every tool stays callable
  by name, and the default list is unchanged.

### MilkDrop

- **Switching to a MilkDrop layer stutters less [777].**
  - Building a MilkDrop layer took one long frame: 133 ms the first time and 53–67 ms after that,
    measured on a 1920×1080, 74 Hz display. The seven built-in programs were compiled and their
    status was asked at once, and the first such question also waited for the new context to
    get ready on the GPU.
  - They now compile in the background, as preset shaders have since #573. The layer starts
    drawing once they are ready, a few frames later.
  - Device limits (anisotropy, texture units) are asked once per process instead of once per
    texture.
  - The first switch now takes 80 ms, and the next ones 27–53 ms, mostly 40.
  - Video export and thumbnails still wait for the compile, so the first frame of a video is
    unchanged. The MilkDrop export in the self-test is byte-for-byte the same size.
- **Motion vectors can be drawn mirrored, as MilkDrop 2 draws them [750].**
  - MilkDrop 2 draws each vector in its place but reads its direction from the vertically
    mirrored row of the mesh. So motion a preset asks for in the top half shows in the bottom
    half. BeatDrop fixed this upstream after #750.
  - Our engine draws what the preset asks for, and that stays the default.
  - Settings → MilkDrop → Motion Vectors → "Mirrored, as in MilkDrop" gives MilkDrop's own
    picture for presets tuned against it. It applies while MilkDrop Fidelity is on.
  - Measured at 960×720, frame 59, on four presets, as the coarse difference out of 255. The
    mirrored mode against stock MilkDrop came out at 1.66, 0.53, 0.95 and 5.47. The default
    mode against patched MilkDrop came out at 0.82, 1.73, 0.92 and 4.8. Across the two (the
    default mode against stock MilkDrop) the differences were 12.9, 31.2, 6.6 and 25.
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

### Packaging

- **The app no longer ships its dependencies' install tools [777].**
  - `app.asar` carried about 120 packages that only run while `npm install` downloads or builds
    native parts. Among them were `cmake-js`, `prebuild-install`, `tar` 6, `axios` and the ffmpeg
    downloader, and some had known vulnerabilities. The app never loads any of them.
  - The package now takes only what the app requires at run time: `audify` with `bindings`,
    `ffmpeg-static` and the Spout texture bridge.
  - audify's C++ sources (17.7 MB) are left out too. The licence texts of the libraries it links,
    Opus and RtAudio, stay in.
  - On Windows, `resources` went from 132 MB to 108 MB.
  - A test fails if the source starts requiring a module the package leaves out.
- **A package without ffmpeg can no longer be built [777].**
  - npm 12 silently skips dependency install scripts that `package.json` does not allow. So on a
    machine with npm 12, `npm install` left out `ffmpeg.exe`, and a package built there would
    have had no working video export.
  - `allowScripts` now allows the scripts of audify, ffmpeg-static and sharp.
  - The packaging step stops if ffmpeg, audify's native module or the Spout bridge is missing.
  - Published builds were not affected: v3.1.5 shipped with ffmpeg.
- **Electron 44 [777].** The app moves from Electron 43 to 44.9.0, Chromium 152.
  - **macOS 13 Ventura or later is now required.** Electron 44 dropped macOS 12.
  - ANGLE is linked into the Electron binary, so `libEGL.dll` and `libGLESv2.dll` no longer ship
    beside it.
  - Electron no longer publishes 32-bit builds; ours were already 64-bit only.
  - None of the other breaking changes reach our code. The `clipboard` module leaves the
    renderer, but ours never used it. The new `net.request` rule does not apply, because the
    updater uses `net.fetch`. And the login-item fields that went away were never used.
  - `node-abi` is updated so `@electron/rebuild` recognises Electron 44.
  - The Dynamic Lighting module, audify and the Spout bridge all load in Electron 44.
- **Electron 43.6.0 → 43.8.0 [777].** The 43.7 and 43.8 releases carry fixes backported from
  upstream Chromium, V8, ANGLE, PDFium, Skia, Dawn and WebRTC. 43.8.0 also fixes Linux start-up
  crashes when GTK fails to load. It is the same major version, and 43 is still supported.
- **Build tools updated [777].** The non-breaking `npm audit` fixes move electron-builder from
  26.15.3 to 26.17.0, along with axios, form-data, undici, xmldom and others in the build chain.
  This takes the audit from 21 findings to 13. The rest have no non-breaking fix:
  - `tar` 6 under `cmake-js` runs only if audify has to be compiled from source, and it no longer
    ships;
  - `sharp` 0.35 is a major version, and sharp is used only for README images;
  - DoS findings deep in electron-builder's dependencies.
- **CI runs with read-only tokens [777].** Every workflow declares `permissions: contents: read`,
  and a test fails if one does not.

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
