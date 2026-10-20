# Audio bridge (#813)

The audio bridge sends the audio one machine captures to other SoundVisualizer machines on the
network, so that the primary and the backup (#540) analyse the same signal. Before this, every
machine captured its own device, and a backup without the same signal drew a flat picture.

This is phase 2 of the redundancy overhaul (#816). It covers capture, transport, pairing,
discovery, the bridge's own analysis, timestamps, the "Network bridge" audio input with automatic
fallback to the local input or a separate fallback device (a mixer split), bridge-only mode, the
panel and the pre-show check. What is still open is listed at the end.

## Modes

| Where | How | What runs |
|---|---|---|
| Normal app, the primary is also the bridge | Settings → Audio Bridge → "Send This Machine's Audio to the Bridge" | Everything as usual. The capture the outputs already use is also sent to receivers. There is one capture, so nothing competes for the device. |
| Bridge-only, separate process | Start the app with `--bridge` | No visual output, no visualizer or renderer windows, no lighting, streaming or OSC, and hardware acceleration is off. It sits in the system tray. Settings are kept in `<userData>/bridge`, so it can run next to the normal app on the same machine without both writing the same `settings.json`. |
| Bridge-only, same settings | Settings → "Audio Bridge Only (next start)" | Like `--bridge`, but with the normal settings folder. Takes effect at the next start. |
| Receiver | Settings → "Audio Input: Network Bridge" | The bridge's frames replace local capture. |

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

Bridge-only mode runs as a single instance per settings folder. Starting it again (shortcut,
jump list, `--bridge`) does not open a second bridge that would fight over the port and the
device. It opens the running bridge's panel instead. The normal app uses another folder, so it
is not affected. `--bridge-multi` turns the lock off, which the test rigs use.

In bridge-only mode the panel opens from the tray icon. On Linux desktops without a tray (stock
GNOME), start the app with `--bridge --panel` instead.

Two bridge processes on the same machine capture the same output device side by side. WASAPI
loopback, PulseAudio/PipeWire monitor sources and CoreAudio inputs all allow more than one client.

## What is sent

Each frame is the capture helper's own analysis frame (`src/main/audio-frame.js`, 7174 bytes):
the sample rate, 1024 spectrum bytes, and 2048-sample mono, left and right windows. Bands, beat,
BPM, onsets and the MilkDrop inputs are computed from this frame in the visualizer, so two
machines that get the same frame get the same numbers. At about 70 frames per second that is
roughly 500 KB/s (4 Mbit/s).

The bridge also runs its own analysis (`src/main/bridge-analysis.js`) and sends it next to the
frames: bass, mid and treble bands, RMS level and peak, beat, BPM and confidence, beat phase and
bar position, onset strength and an onset counter. Beat and BPM use the same engine as the
visualizer (`src/shared/tempo.js`), fed from the frame's spectrum. The packet goes out every
second frame, and right away on a beat. The receiver shows it in the panel. Its own windows still
analyse the frame themselves, so the picture uses the same numbers in both places.

**Timestamps.** Every frame, analysis packet and track update carries the bridge's wall-clock
time in ms (`t`). The receiver converts it to its own clock with the measured offset
(`localT = t - offset`). The frame age, the analysis age and the track's `localT` in the panel all
come from this.

The bridge also sends the now-playing track (title, artist, album, duration, position; artwork
only when it is under 256 KB). While the receiver's input is on the bridge, that track replaces
the local one in the outputs and the panel.

Listenable audio (Opus or PCM) is not sent in this version. It is not needed for picture parity.

## Capture per OS

The bridge uses the same capture code as the normal app (`loopback-helper.js` on audify/RtAudio):

- **Windows:** WASAPI loopback of the output device.
- **macOS:** CoreAudio. System audio needs a virtual loopback device (BlackHole, Loopback), as it
  already does in the normal app, or the app-audio helper (ScreenCaptureKit).
- **Linux:** PulseAudio, or PipeWire through `pipewire-pulse`, using the monitor source of the
  output, with ALSA as a fallback.

The bridge captures only while at least one receiver is connected.

## Wire format, version 1

The bridge listens on TCP, port 8741 by default. This is a separate socket from the redundancy
link, so frames never hold up the heartbeat.

Every packet is `[u32 BE length][u8 kind][payload]`, where the length counts the kind byte and the
payload. The maximum is 1 MB. A bad length closes the connection.

- **kind 0, JSON:** UTF-8 JSON. Every object carries `v` (the format version, currently `1`) and
  `type`.
- **kind 1, frame:** `[u8 version][u32 BE sequence][f64 BE sender time, ms][7174-byte frame]`.

JSON messages after the handshake:

- `{type:'analysis', a:{t, level, peak, bands:{bass, mid, treble}, beat, bpm, confidence, phase, bar, onset, onsets}}`
- `{type:'meta', meta:{has, title, artist, album, duration, position, playing, app, artwork?}, t}`
- `{type:'ping', t0}` and `{type:'pong', t0, t1}`
- `{type:'error', code}`

Handshake:

1. bridge → `{type:'hello', role:'bridge', name, id, nonce}`
2. receiver → `{type:'auth', mac: HMAC-SHA256(secret, 'sv-bridge|c|' + nonce), nonce: own}`
3. bridge → `{type:'welcome', mac: HMAC-SHA256(secret, 'sv-bridge|s|' + own nonce), t}`. The
   receiver checks this too, so it never takes audio from a bridge that does not know the secret.
4. bridge → `meta` (last known track), then frames.

After that, the receiver sends `{type:'ping', t0}` once a second and the bridge answers
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
needs 2 s of uninterrupted frames, so a flaky link does not flip back and forth. With "Fall Back
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
no window or visual output opens, that hardware acceleration is off, that the tray exists and
that the bridge listens. It then opens the panel from the tray path, switches it to English and
checks that the Audio Bridge section has no untranslated text.

## Measurements

`npm run bridge-rig` starts two real instances, a bridge and a receiver whose address field is
empty. It checks discovery, frames, the analysis packets, the fallback when the bridge is killed
(including that the fallback device is the one captured) and the recovery when it comes back.
It runs once with `--bridge` and once with a normal-mode primary as the bridge.
`SV_RIG_FALLBACK` sets the fallback device name.

Ubuntu 24.04 on the CI-class box, PulseAudio null sink with a 440 Hz sine, both on one host
(Electron 44):

| | bridge-only (`--bridge`) | normal mode as bridge |
|---|---|---|
| discovery to connected | ~1.0 s | ~1.0 s |
| round trip / clock offset | 0–1 ms / 0–0.5 ms | 0 ms / 0 ms |
| frame age median / p95 | 0–1.5 ms / 2.5–4.5 ms | 0 ms / 3.5 ms |
| lost frames | 0 | 0 |
| fallback after the bridge is killed | 610–680 ms | 618 ms |
| back on the bridge after restart | ~3.0 s (start + 2 s steady) | ~3.1 s |
| CPU, steady (one core) | ~5 % | ~34 % (panel open) |
| RSS, all processes | ~610 MB | ~910 MB |

Breakdown of the bridge-only RSS: main 184 MB, capture helper 104 MB, network utility 78 MB,
GPU process 47 MB (software only), zygotes 55 + 55 + 14 MB, an idle spare renderer 62 MB, broker
15 MB. RSS counts shared pages in every process, so the real total is lower. The GPU process
and the spare renderer are Chromium's own and could not be turned off. A slim standalone bridge
package (future option) would drop most of this.

On the LAN the round trip and frame age add the network's latency. On Wi-Fi expect a few
milliseconds, with jitter.

## Not done yet

- Listenable audio (Opus/PCM) and a "play the bridge audio" output. Nothing in the app plays
  network audio, and the frames already carry full 2048-sample stereo windows for analysis. A
  continuous PCM stream needs a second packet type from the capture helper (it mixes into ring
  buffers today), so it is left for a follow-up.
- Measurements on Windows and macOS (PC Agent test steps are in the PR).
- Timestamps use the bridge's own clock plus the measured offset, not the redundancy shared clock
  (#544). When the bridge runs on the primary they are the same machine clock.
- Linux deb: no desktop action for the bridge yet. Use the command line.
- A slim standalone bridge package built from the same code (future option, not in scope).
