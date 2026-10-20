# Changelog

What changed in each release, grouped by area. Numbers in brackets are pull requests or issues on
GitHub. The full reasoning and the measurements behind each change are in [ROADMAP.md](ROADMAP.md).

## Unreleased

Changes on a branch, after 3.1.6-beta. Not merged into `main` and not in any build yet.

### Audio bridge, redundancy overhaul phase 2 [813, 816]

- **Fixed: starting the audio bridge a second time crashed on Windows** with "ReferenceError: Cannot access 'instanceTimer' before initialization". The second copy called `app.quit()` while the main process was still loading, and Electron ran the `will-quit` cleanup at once, before the state it touches existed. The second copy now exits right away (the running bridge brings its status window to the front), and the `will-quit` cleanup is skipped until the main process has fully loaded, which also covers a quit signal during startup.
- **What it solves.** Every machine captured its own device. A backup without the same signal drew a flat picture. Now one machine's capture can go to the others, so the primary and the backup analyse the same signal. Details, the wire format and the measurements are in [docs/AUDIO-BRIDGE.md](docs/AUDIO-BRIDGE.md).
- **Inside the app, not a separate program.**
  - "Send This Machine's Audio to the Bridge" works in normal mode, so the primary can be the bridge itself. It uses the same capture, so nothing competes for the device.
  - `--bridge`, or Settings → "Audio Bridge Only", starts without visual output or visualizer windows, without lighting, streaming or OSC, and without hardware acceleration. It opens a small status window and sits in the system tray.
  - **Status window:** broadcasting or stopped, the source, a live level meter with bands, BPM and beats, the connected receivers (name, address, round trip, frame age, lost frames, failed pairings), now playing and errors (device missing, capture failed, port busy). Buttons open the bridge settings, stop or start the bridge, or quit. Closing it keeps the bridge in the tray; the tray reopens it. Without a tray (stock GNOME) the window is the main UI. `--bridge --hidden`, or "Do Not Open the Status Window at Start", starts without it.
  - **Live panel tiles:** the Audio Bridge card's level, bands and beat tiles update about 6 times a second while the panel is visible (bridge-only mode included); only those tiles redraw.
  - **Theme:** an open status window follows theme changes live.
  - **Playback:** drift control trims the buffer back to the target in small steps; playback starts at 30 % volume; the panel warns when the output may echo into this machine's capture.
  - **Source switch:** the bridge tells receivers before it restarts its capture, so they do not briefly fall back.
  - **Where:** the Audio Bridge card is in the Audio category below Audio Sources and Audio Analysis, not behind Advanced. The settings search finds it ("köprü", "bridge"), Settings → App links to it, and "Open Bridge Settings" in the status window or tray opens the panel on it.
  - **Sources:** the status window and the bridge's settings card show the app's own Audio Sources picker (Active Sources, Application Audio with live meters, Refresh Devices). Any mix of outputs (loopback), inputs and single apps is captured and mixed by the same capture helper, and the bridge sends and analyses that mix. Single-app capture: WASAPI process loopback on Windows build 20348+, ScreenCaptureKit on macOS 13+ (Screen Recording permission), the app's PulseAudio/PipeWire stream on Linux. Switching is live and receivers stay connected. If one source is missing or fails, the others keep running and the window names it. In bridge-only mode the list is kept in `<userData>/bridge`. The default is still the single default output.
  - `--bridge` keeps its settings in `<userData>/bridge`, so it can run next to the normal app on the same machine.
  - Bridge-only mode is a single instance. Starting it again brings the running bridge's status window to the front instead of a second bridge.
  - On Windows the installer adds a "CAYADEV Visualizer Audio Bridge" Start menu shortcut, and the taskbar jump list has "Audio Bridge" (installed and portable). The Linux deb adds an "Audio Bridge" action to the launcher. On macOS use `open -n -a "CAYADEV Visualizer" --args --bridge`, and on the AppImage pass `--bridge`.
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

## v3.1.6-beta — in code, not released

`package.json` on `main` is 3.1.6-beta. There is no tag and no GitHub Release yet. The in-app
updater sees v3.1.5 as the latest release and does not offer it to the beta as an update.

The broadcast layout editor (#533) and redundancy (#540) were first planned for v3.1.7 and v3.2.0.
They were built ahead of time and ship in 3.1.6, together with video export.

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
