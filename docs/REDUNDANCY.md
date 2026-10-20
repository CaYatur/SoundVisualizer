# Redundancy: setup guide and reference

*Türkçe: [REDUNDANCY.tr.md](REDUNDANCY.tr.md)*

Two machines run the same show. The **primary** runs it; the **backup** draws the same picture all
the time and takes over if the primary fails. The screen never goes black: your video switcher
picks which machine the audience sees. This page is the setup guide (#815) and the reference for
how authority, outputs and control work (#814). The show package and isolated show space are
phase 1 (#812), the audio bridge is phase 2 (#813, [AUDIO-BRIDGE.md](AUDIO-BRIDGE.md)).

## 1. Wiring

```
                 ┌──────────── audio: mixer split ──────────────┐
                 │                 or the audio bridge (LAN)     │
           ┌─────▼─────┐   LAN: link, beats, show copy   ┌──────▼────┐
           │  PRIMARY  │◄───────────────────────────────►│  BACKUP   │
           └─────┬─────┘                                 └─────┬─────┘
       HDMI/SDI  │   Art-Net / OSC / OpenRGB: only the machine │ HDMI/SDI
                 │   that holds authority sends                │
           ┌─────▼─────────────────────────────────────────────▼─────┐
           │              video switcher → projector / LED          │
           └──────────────────────────────────────────────────────────┘
```

- **Audio.** Both machines must hear the same signal, or the backup draws a different picture.
  Either split the mixer output to both machines, or run the **audio bridge** (Audio → Audio
  Bridge): one machine (or a third device) captures and sends; both choose "Audio Input: Network
  Bridge". If the bridge goes silent, each machine falls back to its own input within 0.6 s.
- **Video.** Each machine feeds its own input of the video switcher. Spout/Syphon and the OBS page
  run on both machines.
- **Lights and OSC.** Only the machine that holds authority sends (see §5). Point both machines at
  the same Art-Net node and OSC target.

## 2. Roles and pairing

1. On both machines: **Show → Redundancy**.
2. Primary: role **Primary**. Press **New Secret** and copy it.
3. Backup: role **Backup**, paste the same secret, enter the primary's address and streaming port
   (default 8722).
4. On the primary, if the backup is another computer: Output → Streaming Output → allow network
   access.

The status pill turns green ("Following the primary" / "Backup connected"). The secret is at
least 16 characters and never travels on the network: both sides prove they know it with an HMAC
challenge. A backup on the previous version can still connect for one release; the pre-show
check warns "Old pairing".

## 3. Firewall and ports

| Port | What | Needed on |
|---|---|---|
| TCP 8722 (your streaming port) | redundancy link, OBS page | primary (and backup if OBS falls back to it) |
| TCP 8741 | audio bridge | the bridge |
| UDP 8742 | bridge discovery | bridge and receivers |
| UDP 6454 | Art-Net witness (optional) | both |

- **Windows:** Defender Firewall asks on the first listen; allow it on *Private* networks. By hand:
  `netsh advfirewall firewall add rule name="SoundVisualizer" dir=in action=allow protocol=TCP localport=8722`
  (repeat for 8741 TCP and 8742/6454 UDP). Virtual adapters (Hyper-V, WSL, VPN) can carry the
  bridge beacon; the receiver prefers an address on its own subnet.
- **macOS:** allow incoming connections when macOS asks. Capturing a single app needs Screen
  Recording permission (macOS 13+); system audio needs BlackHole or Loopback. The app holds an App
  Nap exception while a role is on, so an unfocused backup keeps its timers.
- **Linux:** `sudo ufw allow 8722/tcp` (and 8741/tcp, 8742/udp, 6454/udp) or the firewalld
  equivalent. PipeWire and PulseAudio monitor sources both work. The tray needs an AppIndicator
  host on GNOME. The AppImage needs FUSE, or `--appimage-extract-and-run`.

## 4. What is copied and what is not

| Copied (show keys) | Not copied (setup keys, per machine) |
|---|---|
| live scene, layers, saved scenes, timeline, Clip Deck, Auto VJ settings | audio device, displays, network, lighting targets, export settings, the pairing secret |

- The backup keeps the primary's copy in a separate area (`<userData>/redundancy`); its own show
  is never overwritten and comes back exactly when the role is turned off.
- **Show package** (Show Data → Request Package from Primary): presets, logos and, only if you tick
  them, video files. Chunked, checksummed, resumable, verified before anything is swapped in.
  Files are content-addressed, so a new package never touches a video that is playing.
- **Remove Copied Videos** frees the space again; presets and logos stay.

## 5. Authority and outputs

Exactly one machine holds **authority**: the primary while the backup follows, the backup after it
takes over. Authority decides show decisions (Auto VJ, timeline, Clip Deck) and who sends to
physical lights.

| Output | Default | "Always" |
|---|---|---|
| Art-Net, OSC output (beats, clock, hits too), OpenRGB, Dynamic Lighting | only with authority | both machines send |
| Picture, Spout/Syphon, OBS page | always | — |

When Art-Net loses authority it holds the last frame (default) or sends one black frame.

**Terms.** Every takeover opens a new term (stored in `<userData>/redundancy/term.json`, never goes
down, reset by a new secret). A primary that sees the backup active with a newer term steps back.
A primary that starts with the role on is **fenced** until it has seen the backup's state: a
crashed primary that restarts never drives lights next to an active backup.

**Two masters.** If both machines act as authority (equal terms, or the optional Art-Net witness
sees our universe from another address while we send), both machines show a red alarm and the
pre-show check fails. Release on one machine or hand back. The witness only sees broadcast or
traffic that reaches this machine; hard fencing of DMX needs one physical output path or sACN
priority.

## 6. Takeover, release and hand-back

- **Automatic** (default): the backup takes over when the primary's beats stop for the loss limit
  (1.5 s; 0.3–0.45 s when the primary's process dies and the OS closes the socket).
- **Manual**: "Take Over Manually" (asks first; warns again if the primary is still running).
- **Release** hands control back at once and asks the primary for a fresh copy. After a manual
  Release, automatic takeover pauses until the primary is seen again or you re-arm it.
- **Hand Back to Primary** is the guarded way: it lists every condition (primary beating for 5 s,
  shows match, clock synced, same version) and switches at a moment you choose: now, the next
  scene change, or a blackout.
- **Takeover data**: continue with the primary's copy (default) or this machine's own show.
- **Recovery**: every role-off archives the local show as `local-show.restored-<time>.json`
  (newest 20 kept); Show Data → Local Show Archives restores one, and the current show is
  archived first.

## 7. Reading the status

- The **status banner** above every category while a role is on: role and state, authority and
  term, last beat, clock offset, jitter, audio input. Green: following / backup connected. Amber:
  lost, waiting, fenced, stepped back. Red: backup in control, or two masters.
- **Alarm** on takeover, two masters and a primary that stepped back: the banner flashes until you
  press OK, and the OS shows a notification. Sound is off by default (it could leak into a monitor
  mix); turn on "Play a Sound on Alarm" in the Status group.
- The Redundancy card's tiles: last beat against the loss limit, longest gap, beat interval p95,
  jitter, missed beats, clock offset with its samples, the primary's tempo and the phase error.
- **The other machine**: authority, state, frame rate, audio level, open outputs, a small live
  preview, and buttons for next scene, blackout, next visualizer and timeline play/pause. Commands
  run on the machine with authority.

## 8. Beat sync and the OBS page

- **Beat and phase.** The primary sends its tempo grid (BPM, last beat on the wall clock, bar
  position) with every second heartbeat. A following backup uses it ("Use the Primary's Beat While
  Following", on by default), so both machines count bars together and the backup does not start
  cold after a takeover. The panel shows how far the backup's own detection is from that grid.
- **Listenable bridge audio** is scheduled on the shared clock: two receivers with the same
  latency play the same sample at the same time.
- **OBS / browser source fallback.** Enter the other machine's streaming page address (with its
  token) under Redundancy → Connection → "Streaming Page Fallback Addresses", on both machines,
  and turn on Output → Streaming Output on **both** machines (the backup serves the page after a
  failover). The server sends a small heartbeat to the page twice a second; after 1.5 s of silence
  (a dead, hung or unplugged machine — an unplugged cable never closes the socket) the page drops
  the connection without waiting for it to close and moves to the next address, and it returns to
  the first address as soon as that answers again. The page keeps its last frame and settings; the
  fallback tokens never reach web clients. Video file layers on the page are served by the machine
  the page was loaded from.

## 9. Show-day checklist

1. Same app version on both machines (Settings → Application).
2. Pairing: backup shows "Following the primary", banner green on both.
3. Show → Pre-Show Check: no red rows on either machine.
4. Compare shows on the primary (Show Comparison: "Both machines run the same show"); request
   the package on the backup if not.
5. Audio: both machines show level; with the bridge, "Audio from the bridge" in the pre-show check.
6. Lights: only one machine shows Art-Net/OSC "on" in Output Authority.
7. Rehearse once: Take Over Manually on the backup, check the switcher and the lights, then Hand
   Back to Primary.
8. OBS fallback address entered on both machines if OBS is used.

## 10. Measured

`npm run failover` runs two real app copies on one machine (loopback, 100 ms heartbeat, 1.5 s
limit) and fails if any check fails. `npm run failover -- --report=out.json` writes the numbers.
Windows 11, this version: seven full runs, five of them back to back, every scenario passing in
every run (range). The rig is not part of CI: CI runs the unit tests on Ubuntu and Windows.

| Check | Result |
|---|---|
| Takeover when the primary's process dies | 371–501 ms |
| Art-Net senders while following | 1 |
| Manual takeover moves authority | 290–330 ms, overlap 0 ms |
| Backup matches the primary after Release | 164–167 ms |
| Hand-back | 251–266 ms, overlap 0 ms; refused while the shows differ |
| Restarted primary while the backup is active | 0 Art-Net packets |
| Network cut with the socket open | takeover 1415–1515 ms; both send during the cut; primary steps back 316–317 ms after the link returns, no alarm |
| Hung primary (process suspended) | takeover 2044–2459 ms (includes the PowerShell suspend command); primary steps back on resume |
| Peer preview open (real visualizer window) | the primary saw the backup's beat at most 96 ms old during the preview; the backup's longest gap stayed far under the 1.5 s limit |
| OBS page, primary hung (suspended) | page on the backup after 2.2 s (incl. ~0.5 s for the suspend command); back on the primary 5.3 s after it resumes |
| OBS page, primary killed | page on the backup after 2.1 s |
| Both machines restarted | term kept (2 → 2), backup follows, primary unfenced |
| Bridge fallback when the bridge dies | 610–680 ms (`npm run bridge-rig`) |
| Beat grid transfer (simulated, 0–15 ms delivery jitter) | p95 < 20 ms (unit test; not measured with live audio, see the two-PC procedure) |
| Bridge audio, two receivers (simulated jitter 2–60 ms) | max 5 ms apart (unit test) |

### Two-PC procedure

The numbers above are from one machine. Run this on two PCs on a wired LAN and record the results
with `--report`:

1. Pair A (primary) and B (backup); Art-Net to a node or a sniffer (`tcpdump udp port 6454`), OSC
   to a third host, OBS on a third machine with the fallback address. Expect only A's IP sending.
2. Play 120 BPM music for 2 minutes. Expect equal BPM within 0.5 and a phase error p95 under 30 ms.
3. Pull A's cable. Expect B to take over in about 1.5 s, B's IP the only sender, the alarm on B,
   OBS on B within 3 s.
4. Plug A back in. Expect A to step back within one heartbeat, no alarm.
5. Kill A while B follows, restart A. Expect A to send nothing until it sees B.
6. Block only TCP 8722 between them. Expect the two-masters alarm within 3 s via the Art-Net witness.
7. Change scenes on A while B is in control, then Release on B. Expect B to match A within 1 s.
8. Hand back at the next scene change; once more with a preset changed only on A (refused: show
   differs). Repeat in TR and EN and check that no untranslated text appears.

## Not done

- **Real two-PC LAN run, macOS measurements, packaged-build checks of the jump list, dock menu and
  tray on macOS and Linux.** These need hardware this project was not tested on; the procedure is
  above. All automated checks run on Windows and in CI on Ubuntu and Windows.
- **Opus for bridge audio.** It needs a native or wasm encoder on three platforms; PCM (about
  1.5 Mbit/s per listener) is enough on a wired LAN.
- **A slim standalone bridge** (Node without Chromium). It would be a separate signed product per
  platform; the bridge-only mode of the app uses about 5 % of one core.
- **Several bridges with automatic choice.** One bridge is a single point of failure for analysis;
  the fallback input (mixer split) covers it.
- **The bridge as a third split-brain witness.** It would tie the optional bridge to redundancy.
