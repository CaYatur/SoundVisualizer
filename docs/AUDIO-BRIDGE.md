# Audio bridge (#813)

The audio bridge sends the audio one machine captures to other SoundVisualizer machines on the
network, so that the primary and the backup (#540) analyse the same signal. Before this, every
machine captured its own device, and a backup without the same signal drew a flat picture.

This is phase 2 of the redundancy overhaul (#816). It covers capture, transport, pairing,
discovery, the bridge's own analysis, timestamps (bridge clock, receiver clock and the redundancy
shared clock), listenable audio (PCM), the "Network bridge" audio input with automatic fallback to
the local input or a separate fallback device (a mixer split), bridge-only mode with a small status
window and a source picker (device or a single app), the panel and the pre-show check. What is
still open is listed at the end.

## Where to find it

Panel → **Audio** category → **Audio Bridge** card, right below Audio Sources. It is not behind
the Advanced toggle. The settings search finds it under "köprü" or "bridge", Settings → App has
an "Open Audio Bridge Settings" button, and "Open Bridge Settings" in the bridge's status window
or tray opens the panel on that card.

## Modes

| Where | How | What runs |
|---|---|---|
| Normal app, the primary is also the bridge | Audio → Audio Bridge → "Send This Machine's Audio to the Bridge" | Everything as usual. The capture the outputs already use is also sent to receivers. There is one capture, so nothing competes for the device. |
| Bridge-only, separate process | Start the app with `--bridge` | No visual output, no visualizer windows, no lighting, streaming or OSC, and hardware acceleration is off. A small status window opens (see below) and an icon sits in the system tray. Settings are kept in `<userData>/bridge`, so it can run next to the normal app on the same machine without both writing the same `settings.json`. |
| Bridge-only, same settings | Audio → Audio Bridge → "Audio Bridge Only (next start)" | Like `--bridge`, but with the normal settings folder. Takes effect at the next start. |
| Receiver | Audio → Audio Bridge → "Audio Input: Network Bridge" | The bridge's frames replace local capture. |

`--bridge` works with the installed build, the portable build, the AppImage and the dev build
(`npm start -- --bridge`), because it is a plain command-line flag read by the main process.
`--panel` also opens the panel at start. `--bridge-shared-profile` keeps the normal settings
folder.

| OS / build | How to start the bridge |
|---|---|
| Windows, installer | Start menu → "CAYADEV Visualizer Audio Bridge" (added by the installer), or right-click the taskbar icon → "Audio Bridge" |
| Windows, portable | Taskbar jump list → "Audio Bridge", or `CAYADEV-Visualizer-<version>-windows-portable.exe --bridge` |
| macOS | `open -n -a "CAYADEV Visualizer" --args --bridge` (`-n` starts a second copy next to the normal app) |
| Linux, AppImage | `./CAYADEV-Visualizer-<version>-linux-x86_64.AppImage --bridge` |
| Linux, deb | `"/opt/CAYADEV Visualizer/soundvisualizer" --bridge` |
| Dev | `npm start -- --bridge` |

Linux deb also adds an "Audio Bridge" action to the app's desktop entry (right-click the launcher).

Bridge-only mode runs as a single instance per settings folder. Starting it again (shortcut,
jump list, `--bridge`) does not open a second bridge that would fight over the port and the
device. It brings the running bridge's status window to the front instead (`--panel` also opens
the panel). The second copy exits before the main module finishes loading, without running the
quit cleanup. The normal app uses another folder, so it is not affected. `--bridge-multi` turns
the lock off, which the test rigs use.

### Status window

Bridge-only mode opens a compact status window (`src/bridge-status/`, 460×640, resizable). It draws
no visuals and runs with hardware acceleration off. It shows:

- broadcasting / stopped, the bridge's name and port;
- the sources: the app's Audio Sources picker (any mix of outputs, inputs and single apps, with live app meters), and an error line for each source that is missing or failed;
- a live level meter with peak, B/M/T bands, BPM, beats and analysis age;
- connected receivers with name, address, round trip, frame age, lost frames, and failed
  pairing attempts (wrong secret);
- now playing (the bridge's own media session, SMTC, on Windows only; title, artist, album, state,
  duration and whether a cover is being sent). Elsewhere the window says it cannot be read there;
- errors: device missing, capture failed, port busy, app capture unavailable.

Buttons: "Bridge Settings" (opens the panel), "Stop Bridge" / "Start Bridge" (stops sending and the
beacon, the process stays), "Quit". Closing the window keeps the bridge running in the tray and
frees the window's renderer; the tray menu reopens it. Without a tray (stock GNOME) the window is
the main UI, and closing it quits the bridge.

`--bridge --hidden`, or Settings → "Do Not Open the Status Window at Start" (bridge-only), starts
without the window, for autostart and headless use. Without a tray, `--hidden` is ignored so the
bridge can always be stopped.

### Sources: the app's Audio Sources

The bridge does not have its own source picker. The status window and the bridge's settings card
show the app's **Audio Sources** picker itself (`src/admin/audio-sources.js`, the same part the
Audio Sources card uses): "Active Sources" with every output (loopback) and input, "Application
Audio" with each app that is playing, its live meter and the include/exclude mode, and "Refresh
Devices". Any mix can be selected; the capture helper (`loopback-helper.js`) captures them all
and mixes them into one stream, as it does for the visualizer, and the bridge sends and analyses
that mix. The default is a single source, the default output, as before.

The list is `audio.sources`. In bridge-only mode it lives in the bridge's own settings folder
(`<userData>/bridge/settings.json`), separate from the normal app's list. When the primary is the
bridge, it is the primary's own list, because there is one capture.

Changing the list is live: the capture helper restarts with the new list, while the TCP server,
the beacon and the connected receivers stay up (receivers see a short gap of a few frames).

If one source fails, the others keep running. The helper reports each source that is missing,
failed to open, or (for an app) is not running, and the status window names it in TR/EN under
the picker.

| OS | Single-app capture | Needs |
|---|---|---|
| Windows | WASAPI process loopback | Windows build 20348 or newer (Windows 11, Server 2022) |
| macOS | ScreenCaptureKit app audio | macOS 13 or newer and the Screen Recording permission |
| Linux | PulseAudio / PipeWire (`pactl`) per-app stream | `pactl`, `parec` |

Where single-app capture is not possible (older OS, permission denied, helper or tools missing),
the window says why in TR/EN and the bridge keeps capturing the selected devices (or the default output if only apps were
selected). The choice is saved and comes back at the next start.

**Known gap (Windows): packaged apps such as the new Media Player (`Microsoft.Media.Player`).**
The app list comes from the app-audio helper (`native/app-audio-helper/Program.cs --list`), which
walks the audio sessions of the *default* render endpoint only and names each session by its
process. A player that renders to another output, or whose session the helper cannot name, is
not listed. The same helper serves the normal app's Application Audio list, so this predates the
bridge. Workaround: capture the output device the player uses. Listing sessions on every active
endpoint and resolving packaged-app names is tracked for #815 (it needs a rebuilt, signed helper
and a Windows test round).

Two bridge processes on the same machine capture the same output device side by side. WASAPI
loopback, PulseAudio/PipeWire monitor sources and CoreAudio inputs all allow more than one client.

## What is sent

Each frame is the capture helper's own analysis frame (`src/main/audio-frame.js`, 7174 bytes):
the sample rate, 1024 spectrum bytes, and 2048-sample mono, left and right windows. Bands, beat,
BPM, onsets and the MilkDrop inputs are computed from this frame in the visualizer, so two
machines that get the same frame get the same numbers. The rate follows the OS capture buffer:
measured 63.6 frames per second on Windows (WASAPI) and about 69 on Linux (PulseAudio/PipeWire),
so roughly 455-500 KB/s (3.7-4 Mbit/s).

The bridge also runs its own analysis (`src/main/bridge-analysis.js`) and sends it next to the
frames: bass, mid and treble bands, RMS level and peak, beat, BPM and confidence, beat phase and
bar position, onset strength and an onset counter. Beat and BPM use the same engine as the
visualizer (`src/shared/tempo.js`), fed from the frame's spectrum. The packet goes out every
second frame, and right away on a beat. The receiver shows it in the panel. Its own windows still
analyse the frame themselves, so the picture uses the same numbers in both places.

**Timestamps.** Every frame, analysis packet, PCM chunk and track update carries the bridge's
wall-clock time in ms (`t`). The receiver converts it to its own clock with the measured offset
(`localT = t - offset`). When redundancy is on, it adds one more step onto the shared show clock
(#544): `sharedT = localT - sharedEpoch`, where the primary's epoch is its own session start and
the backup's is the primary's, converted with the redundancy link's measured offset. The same
bridge moment then gives the same `sharedT` on both machines, even when the bridge is a third
device. The panel shows which clock is in use ("shared clock" or "this machine's clock").

The bridge also sends its own now-playing track. While the receiver's input is on the bridge,
that track, cover included, replaces the local one in the outputs (now-playing card, text layers,
lyrics) and the panel.

- **Every field is optional.** The bridge sends only the fields its media session gives and drops
  any field of the wrong type. A receiver treats a missing field as empty, so a bridge without a
  media session, a track without a cover or a stream without a duration never breaks anything.
- **Cover once per track.** The bridge shrinks the cover to at most 512 px, re-encodes it as JPEG
  (quality 85, at most 400 KB) and sends it once per receiver as `{type:'artwork', id, data}`,
  with `id` the first 16 hex digits of its SHA-1. Each `meta` message then carries only
  `artworkId`; position updates do not resend it. A receiver that connects later gets the
  current cover right after pairing. A cover that is not an image data URL, or too big, is left
  out and the rest of the track still goes.
- **Timing.** `updated` and `received` are moved onto the receiver's clock with the measured
  offset, so the position runs correctly on the other machine.

### Platform support

Detected at run time; nothing is assumed from the build. What a platform lacks is left out and
the status window says so in TR/EN; the bridge keeps running.

| | Title | Artist | Album | Cover | Position / state | Single-app capture |
|---|---|---|---|---|---|---|
| Windows | yes (SMTC) | yes | yes | yes | yes | build 20348+ (WASAPI process loopback) |
| macOS | no | no | no | no | no | macOS 13+ with Screen Recording (ScreenCaptureKit) |
| Linux | no | no | no | no | no | with PulseAudio or PipeWire (`pactl`, `parec`) |

The app reads the media session only on Windows, locally too, so on macOS and Linux the bridge
sends no track and the receiver's own now-playing stays as it is (empty there as well). A macOS
(MediaRemote) or Linux (MPRIS) reader would plug into the same media session and its fields
would go over the bridge unchanged; that is not part of this phase. Where single-app capture is
not possible, the Application Audio list is replaced by the reason (old build, no permission
with a button to ask for it, no sound server, unsupported OS) and the devices stay selectable.

**Listenable audio (PCM).** A receiver can also play the bridge's audio: Audio → Audio Bridge → "Play the
Bridge's Audio on This Machine", with an output device, a volume and a jitter buffer (40–1000 ms,
default 120 ms). The receiver asks for audio in its `auth` message (`audio: true`) or later with
`{type:'audio', on}`, so receivers that only analyse get no PCM. The capture helper emits 16-bit
stereo PCM next to its frames (same pipe, its own marker) only while a sender exists. A hidden
player window (`src/bridge-audio/`) schedules the chunks with Web Audio and `setSinkId`; gaps and
late chunks are counted. Drift control keeps the buffer at the target: if even the lowest fill
over half a second stays above the target (the bridge's clock runs fast, or chunks piled up after
an output change), the excess is dropped one chunk (~10 ms) at a time; bursts that drain again
are left alone, and above 3× the target a chunk is dropped at once. Playback starts at 30 %
volume the first time it is turned on. The panel warns about an echo when the output is probably
the device this machine captures (system default output while the bridge runs on this machine,
or an output whose name matches a captured source). 48 kHz stereo is about 1.5 Mbit/s per listening receiver. PCM was chosen
over Opus: no native or wasm encoder to ship on three OSes, and the LAN has the bandwidth.

## Capture per OS

The bridge uses the same capture code as the normal app (`loopback-helper.js` on audify/RtAudio):

- **Windows:** WASAPI loopback of the output device.
- **macOS:** CoreAudio. System audio needs a virtual loopback device (BlackHole, Loopback), as it
  already does in the normal app, or the app-audio helper (ScreenCaptureKit).
- **Linux:** PulseAudio, or PipeWire through `pipewire-pulse`, using the monitor source of the
  output, with ALSA as a fallback.

The bridge captures only while at least one receiver is connected, or while its status window is
visible (for the level meter).

## Wire format, version 1

The bridge listens on TCP, port 8741 by default. This is a separate socket from the redundancy
link, so frames never hold up the heartbeat.

Every packet is `[u32 BE length][u8 kind][payload]`, where the length counts the kind byte and the
payload. The maximum is 1 MB. A bad length closes the connection.

- **kind 0, JSON:** UTF-8 JSON. Every object carries `v` (the format version, currently `1`) and
  `type`.
- **kind 1, frame:** `[u8 version][u32 BE sequence][f64 BE sender time, ms][7174-byte frame]`.
- **kind 2, PCM:** `[u8 version][u32 BE sequence][f64 BE sender time, ms][u32 BE sample rate][u8 channels][s16 LE interleaved samples]`.
  Sent only to receivers that asked for audio.

JSON messages after the handshake:

- `{type:'analysis', a:{t, level, peak, bands:{bass, mid, treble}, beat, bpm, confidence, phase, bar, onset, onsets}}`
- `{type:'meta', meta:{has?, title?, artist?, album?, duration?, position?, playing?, app?, subtitle?, updated?, received?, artworkId?}, t}`
- `{type:'artwork', id, data}` (the cover as a JPEG data URL, once per track and receiver)
- `{type:'switching', ms, t}`: the bridge is changing its sources; receivers do not fall back for
  up to `ms` (at most 5000) while the capture helper restarts
- `{type:'ping', t0, r:{name, rttMs, ageMs, lost}}` and `{type:'pong', t0, t1}` (the report
  feeds the bridge's receiver list)
- `{type:'audio', on}` (receiver → bridge, start or stop PCM)
- `{type:'error', code}`

Handshake:

1. bridge → `{type:'hello', role:'bridge', name, id, nonce}`
2. receiver → `{type:'auth', mac: HMAC-SHA256(secret, 'sv-bridge|c|' + nonce), nonce: own}`
3. bridge → `{type:'welcome', mac: HMAC-SHA256(secret, 'sv-bridge|s|' + own nonce), t}`. The
   receiver checks this too, so it never takes audio from a bridge that does not know the secret.
4. bridge → `meta` (last known track), then frames.

After that, the receiver sends `{type:'ping', t0, r}` once a second and the bridge answers
`{type:'pong', t0, t1}`. The clock offset is `t1 - (t0 + t3) / 2`, taken from the sample with the
shortest round trip out of the last eight. A frame's age is
`now - (sender time - offset)`. The panel shows the round trip, the offset, the frame age and lost
frames (gaps in the sequence numbers).

A receiver that falls behind (more than 256 KB queued on its socket) gets frames skipped instead of
building up delay. The skipped frames are counted and shown.

A peer that sees an unknown `v` closes the connection with `{type:'error', code:'version'}`, and
the panel says the versions differ.

## Pairing and discovery

The pairing secret must be at least 16 characters and the same on the bridge and the receiver.
The secret never goes on the wire. The MCP server cannot read or write `bridge.secret`.

Discovery uses a UDP broadcast beacon on port 8742, sent once a second to `255.255.255.255` and to
the broadcast address of every IPv4 interface:

```json
{ "app": "sv-bridge", "v": 1, "id": "…", "name": "…", "port": 8741, "ts": 0, "mac": "HMAC(secret, id|port|ts)" }
```

The receiver lists every bridge it hears. It pairs only with beacons whose signature matches its
secret and that are less than 30 s old; the others are listed with the reason (different secret,
clock too far off, different version). A bridge that has not been heard for 5 s drops off the
list. When "Bridge Address" is empty, the receiver connects to the first paired bridge. A typed
address always wins.

**Several network adapters.** A bridge machine with Hyper-V, WSL, VPN or Docker adapters sends its
beacon from each of them, so the same bridge is heard from several addresses every second. The
list keeps one entry per bridge id with all its addresses, ordered: an address on the same subnet
as one of this machine's adapters first, then the first one heard. While connected, the receiver
keeps its address and ignores the others. It moves to the next address only when a connect fails
or the link drops, and it always closes the old socket first.

**Reconnect.** After a drop the receiver retries after 250 ms, 500 ms, then every 1 s (it no
longer backs off to 5 s), and a beacon from the paired bridge triggers an immediate attempt.

A UDP beacon was chosen over mDNS because it needs no daemon. That matters on Linux without avahi,
and on Windows and macOS it needs no extra service.

**Firewalls:** allow TCP 8741 (or your port) and UDP 8742.

- Windows Defender Firewall asks once, when the app first listens. Allow private networks.
- The macOS application firewall asks the same way.
- On Linux, open the ports in ufw or firewalld if they are active.

Discovery does not cross routers or VLANs. Type the address there.

## Network bridge input and fallback

`src/main/bridge-input.js` is a small state machine:

- **waiting:** no frames yet. The local input runs if fallback is on.
- **bridge:** frames come from the bridge. Local capture is stopped.
- **fallback:** the bridge has been silent for 600 ms. Local capture starts again.

The first switch to the bridge happens after 300 ms of steady frames. Going back after a loss
needs 500 ms of uninterrupted frames, so a flaky link does not flip back and forth, yet the input
is back on the bridge well within 2 s of the bridge returning. With "Fall Back
to the Local Input if the Bridge Goes Silent" off, audio simply stops while the bridge is gone.

**Fallback input.** "Fallback Input" picks what is captured while the bridge is silent: the
normal audio input (the default), or any other device on this machine. For a mixer split, wire
a second output of the mixer into this machine's audio interface and pick that input. The
choice is kept even when the device is not plugged in, and it is shown as "not found".

The pre-show check shows the active source: bridge (with its name and address), fallback (the
local input, or the fallback device by name), or waiting.

While the input is on the bridge, the bridge's track is used everywhere: the outputs, the panel,
the OSC track title, the stream page and MCP.

## Self-test

`npm run smoke:bridge` starts the app with `--smoke --bridge` on a fresh profile. It checks that
only the status window opens (no visual output), that hardware acceleration is off, that the tray
exists and that the bridge listens. It switches the status window to English (both source tabs)
and checks for untranslated text, then opens the panel from the tray path and checks the Audio
Bridge section the same way.

## Measurements

`npm run bridge-rig` starts two real instances, a bridge and a receiver whose address field is
empty. It checks discovery, frames, the analysis packets, the fallback when the bridge is killed
(including that the fallback device is the one captured) and the recovery when it comes back
after an outage of at least 8 s (`SV_RIG_OUTAGE_MS`); the input must be back on the bridge within
6 s of the relaunch, cold start included (`SV_RIG_RECOVER_MS`). It runs once with `--bridge` and
once with a normal-mode primary as the bridge. `SV_RIG_FALLBACK` sets the fallback device name.
The unit tests add a beacon heard from several source addresses and a receiver that must not
reconnect when the order changes.

`npm run bridge-sources-rig` (Linux, `pactl`) adds two synthetic sources, null sinks with a
440 Hz and a 1000 Hz sine. It checks that the helper's mix of both has both tones in its spectrum
(one source alone has one), that a missing third device is reported while the others keep
running, and, end to end, a `--bridge` with those three sources: the receiver switches to the
bridge, the status window shows the shared picker and the missing source, a live change of the
list keeps the receiver connected, and the new list is saved in `<userData>/bridge`.

Ubuntu 24.04 on the CI-class box, PulseAudio null sink with a 440 Hz sine, both on one host
(Electron 44):

| | bridge-only (`--bridge`) | normal mode as bridge |
|---|---|---|
| discovery to connected | ~1.0 s | ~1.0 s |
| round trip / clock offset | 0–1 ms / 0–0.5 ms | 0 ms / 0 ms |
| frame age median / p95 | 0–1.5 ms / 2.5–4.5 ms | 0 ms / 3.5 ms |
| lost frames | 0 | 0 |
| fallback after the bridge is killed | 610–680 ms | 618 ms |
| back on the bridge after an 8 s outage (from relaunch) | ~0.9 s | ~1.0 s |
| CPU, steady (one core) | ~5 % hidden; ~14 % with the status window and its live meter (software compositing) | ~34 % (panel open) |
| RSS, all processes | ~400 MB hidden and idle, ~610 MB capturing, ~710 MB with the status window | ~910 MB |

The PC Agent measured the bridge alone on Linux at 4.6 % of one core and 608 MB RSS across 9
processes. Breakdown of the bridge-only RSS: main ~185 MB, capture helper ~104 MB (only while a
receiver is connected or the window is visible), network utility ~78 MB, GPU process ~50 MB
(software only), zygotes 55 + 55 + 14 MB, the status window's renderer ~130 MB (only while it is
open), broker 15 MB. RSS counts shared pages in every process, so the real total is lower.

What was trimmed cheaply: closing the status window now destroys it instead of hiding it (its
renderer goes away; the tray reopens it), `--hidden` creates no window at all, and the capture
helper runs only while someone needs it. The GPU process, the network utility process and the
zygotes are Chromium's own and cannot be turned off from the app. A slim standalone bridge (a
plain Node process with the capture helper, no Chromium) would drop most of this, but it would be
a separate product to build, sign and ship on three OSes; it is left as a future option (#815).

On the LAN the round trip and frame age add the network's latency. On Wi-Fi expect a few
milliseconds, with jitter.

## Not done yet

- Measurements on Windows and macOS with real hardware (PC Agent test steps are in the PR).
- Opus instead of PCM, for Wi-Fi or many listeners (PCM is ~1.5 Mbit/s per listener).
- PCM playback is scheduled on the receiver's clock; it is not yet locked sample-accurately to
  the shared show clock across two receivers.
- A slim standalone bridge package without Chromium (future option, #815; see Measurements).
- The bridge is a single point of failure for the analysis; two bridges with automatic choice
  between them are not in this phase.
