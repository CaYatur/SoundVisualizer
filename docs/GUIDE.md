# User guide: from install to your first show

[Türkçe](GUIDE.tr.md)

This guide walks through the application in the order you meet it: hear your music, build a look,
save it, put it on a screen, control it, and send it somewhere. Each part takes a few minutes. The
[README](../README.md) is the reference for every feature; this page is the path through them.

Names in **bold** are the labels you see in the English interface.

## 1. Install and open

Download the build for your system from the
[latest release](https://github.com/CaYatur/SoundVisualizer/releases/latest) and run it. Nothing
else needs to be installed. The [Quick start](../README.md#quick-start) table says which file is
for which system.

The panel opens on the **Scene** page with a starter scene: a bar visualizer over a gradient. The
preview in the middle is the picture your screens will show. A **Demo** badge on the preview means
a built-in sample signal is driving it, so you can try everything before any audio is set up. Click
the badge and it turns to **Live**: the preview then follows your real audio. It also switches by
itself while a visualization window is open.

Five pages sit in the capsule at the top:

| Page | What it is for |
|---|---|
| **Scene** | Everything on screen: backgrounds, visualizers, logo, text, effects |
| **Live** | Running a show: scene grid, TAKE, T-bar, tempo, Auto VJ |
| **Time** | A timeline that plays scenes and setting changes along a track |
| **Studio** | Writing your own shaders, generating scenes and MilkDrop presets |
| **Output** | Where the picture goes: screens, OBS, Spout / Syphon, recording, video files |

The **Simple** switch hides the two advanced pages (Time and Studio) and the advanced settings. The
gear opens **Setup**, where audio, lighting, controllers and the application's own settings live.

Two things worth knowing from the start:

- **Search.** `Ctrl` + `K` searches every setting, mode and effect. Type what you are thinking of
  ("microphone", "green screen", "phone", "export"); the result takes you there.
- **Shortcuts.** `?` opens the list of keyboard shortcuts.

Everything you change is applied at once and saved by itself. There is no Save button for settings.

## 2. Hear your music

Click the speaker chip at the top left, or open **Setup → Audio → Audio Sources**.

- **Default Output (Active Speaker)** listens to whatever the computer is playing. It is selected
  on a new install, so in most cases music from any player already moves the visuals.
- Tick a **microphone** or line input to react to the room instead, or as well: several sources can
  be ticked together and are mixed.
- **Application Audio** lists the programs that are playing sound right now. Tick one to follow only
  that program (for example the music player and not the game). Play something, then press
  **Refresh Devices** if the program is not listed.

Choosing a source switches the preview from **Demo** to **Live** by itself (the badge does the same
when you click it); the small meter next to the tempo starts to move with the sound. If the
visuals look too calm or too wild, **Setup → Audio → Audio Analysis** has sensitivity and
smoothing.

On macOS, system audio needs a virtual device; on Linux, PulseAudio or PipeWire. The
[audio section](../README.md#audio-capture-and-analysis) of the README has the details.

## 3. Build a look

The **Scene** page has three columns.

**Left: Layers.** A scene is a stack of layers, and the one at the top of the list is drawn in
front. **Add** offers the layer types: Background, Visualizer, MilkDrop, Media (webcam, video file,
or a screen or window), Visual Objects, Logo, Now Playing, Text, Lyrics and more. Drag a layer to
reorder it; click it to select it.

**Right: the inspector.** It shows the settings of whatever is selected. With **Scene** selected at
the top of the list, it shows the scene's own settings: **Color Theme**, the transition used when
scenes change, the main effect chain, and **Transparent Background**. With a layer selected, it
shows that layer's mode, size, position, colors and blending.

**Bottom: the shelf.** This is the library you pick from:

- **MilkDrop**: the bundled presets, with search, favourites and import for your own `.milk` files.
- **Visualizer** and **Background**: every mode with a small picture. Clicking one changes the
  selected layer, or adds a new layer when nothing suitable is selected.
- **Preset**: ready-made scenes grouped by use (club, ambient, streaming, music video, and more).
  Applying one replaces the current look.
- **Scene**: the scenes you have saved.

The second icon on the shelf switches it to the tools: **Effect Chain**, **Modulation** and
**Groups**.

To resize the panels, drag the divider above the shelf or beside either side column. The sizes
follow the window; double-click a divider to reset it, or use **Settings → Application → Reset Panel
Sizes** to reset them all.

A good first exercise:

1. Pick a preset from **Preset** that is close to what you want.
2. Select its visualizer layer and try a few other modes from the **Visualizer** shelf.
3. Select **Scene** and change the **Color Preset**.
4. Add a **Logo** or **Text** layer and drag it into place in the preview.

`Ctrl` + `Z` undoes any step.

## 4. Save scenes

A **scene** is a named snapshot of the whole look. Press the save icon in the inspector's header (or
**Save** on the Live page) and type a name. Saved scenes appear on the **Scene** shelf, on the Live
page's grid and on the phone remote.

On a new install the Live page offers **Add example scenes**. It adds eight scenes built from the
ready-made presets, without changing what is currently on screen. They are a quick way to try the
Live page before you have made scenes of your own.

## 5. Put it on a screen

1. Choose the display from the display menu at the top right. Several displays can be ticked on the
   **Output → Display** page; each gets its own full-screen window.
2. Press **Open Visualizer**.
3. Press `Esc` in a visualization window to close them all.

While the output has the focus, these keys work there too:

| Key | Action |
|---|---|
| `Space` | Blackout; press again to bring the scene back |
| `F11` | Switch between full screen and a window |
| `Ctrl` + `S` | Save a PNG snapshot |
| `Ctrl` + `R` | Start or stop recording |

**Output → Display** also has the **Floating window (PiP)**: a small always-visible window with
opacity and click-through, for keeping the visuals over your desktop while you work.

## 6. Run a show from the Live page

The **Live** page is built for changing looks while the music plays.

- The **scene grid** holds your saved scenes. Click one, or press `F1`–`F12`, to **cue** it: it
  appears in the **Next** monitor while the audience still sees the **Live** one.
- **TAKE** (or `Enter`) puts the cued scene live with the scene transition.
- The **T-bar** between the monitors mixes the cued scene in by hand. Stop halfway and both scenes
  stay blended; pull it back and nothing has changed.
- **Momentary Effects** (Flash, Strobe, Blur, Kaleidoscope, Glitch, Negative) act only while held.
- **Tap Tempo** sets the tempo by hand when detection is unsure; the BPM display shows what the app
  is following.
- **Auto VJ** changes scenes for you on the beat. Start it and it works through your scenes.
- The faders at the bottom are the opacity of each layer, with solo and mute, next to the main
  output fader.

The **Clip Deck** tab next to the scene grid is a launch grid for scenes, presets, palettes and
media that fire on the beat; the **Time** page is for a show that follows a track from start to
end. Both are described in the
[show control section](../README.md#show-control-timeline-clip-deck-auto-vj-midi-and-osc).

## 7. Make it react the way you want

**Effects.** On the shelf's tools, **Effect Chain → Add Effect** puts an effect on the whole
picture: bloom, trails, glitch, color correction and about forty more. A layer has its own chain in
the inspector, so an effect can touch one layer only.

**Modulation.** Any slider can be driven by the music. In **Modulation**, **Add Route** connects a
source (bass, a custom band, an LFO, an envelope follower, a macro knob) to a setting with an
amount. Start with one route, for example *bass → the visualizer's size*, and listen to what it
does before adding more.

## 8. Control it from somewhere else

All of these are off until you turn them on.

- **Phone remote.** Turn on **Output → Streaming Output (OBS / Web)**, allow access from the local
  network, and open the remote's address on a phone on the same Wi-Fi. It has pages for live
  control, scenes, layers, appearance and audio.
- **MIDI.** In **Setup → Control → MIDI Controller**, press **Learn** on a row and move a knob or
  press a pad. Notes can trigger actions (next scene, blackout); knobs and faders drive settings.
- **OSC, gamepad, MQTT / Home Assistant, Art-Net** are on the same Control page, each with its own
  card.

## 9. Send the picture somewhere

On the **Output** page:

- **Streaming Output (OBS / Web)** serves the visuals as a web page. Add its address to OBS as a
  **Browser Source**; with **Transparent Background** on, only the visuals are laid over your
  stream.
- **Spout / Syphon Output** hands the picture to another program on the same computer through the
  GPU.
- **Recording & Snapshot** records what is on screen as it happens.
- The profiles under **To a File** (YouTube, Reels / Shorts / TikTok, Instagram, GIF loop and more)
  open **Video Export**: choose an audio file and the scene is drawn frame by frame for the whole
  track. It is not a screen recording, so the result does not depend on how fast your computer is,
  and the same job always gives the same video.

## 10. Before a real show

- **Setup → Show → Pre-show Check** looks at screens, audio, frame rates, the scene's files and disk
  space in one place.
- **Accidental-Close Protection** (Setup → Settings) stops `Esc` from closing the output by mistake;
  `Ctrl` + `Shift` + `Q` still closes it.
- **Setup → Library → Back Up / Restore Settings → Create Full Backup** writes the settings, the
  scenes, the color presets and the files the scenes use (presets, logos, videos, lyrics, MilkDrop
  textures) to one `.svbackup` file. Take one before a show, and use **Restore from Full Backup** to
  move your setup to another computer: the videos are put in place there and the scenes point to
  them. **Include Videos** can be turned off for a smaller file; the card says how much video the
  scenes use. **Settings Only** is the older JSON file with the settings alone.
- If the picture stutters on a weak machine, **Output → Power / Performance** has **Adaptive
  Resolution** and a frame-rate limit.

## Where to go next

- [Modulation cookbook](MODULATION-COOKBOOK.md): recipes you can copy.
- [Shader authoring guide](SHADER-GUIDE.md): write your own visualizer or background in Studio.
- [MIDI controllers](midi-controllers.md) and the [remote protocol](REMOTE-PROTOCOL.md).
- The [FAQ](../README.md#faq) in the README.
