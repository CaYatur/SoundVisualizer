# Phone link protocol

The SoundVisualizer Android app can run a desktop copy of SoundVisualizer over the local network:
scenes, layers, the timeline, live control, outputs, and the phone's audio. This page describes
the wire protocol and the security model (issue #1054). Turkish: [PHONE-LINK.tr.md](PHONE-LINK.tr.md).

Source: `src/main/phone-link.js` (core, pure), `src/main/phone-link-service.js` (sessions and
dispatch), `src/main/stream-server.js` (`/link` transport), `src/main/link-discovery.js` (network
announcement), `src/shared/qr.js` (pairing QR code), `src/admin/phone-link-panel.js` (panel card).

## Principles

- **Off by default.** The user turns it on in Settings → Control → Phone Link.
- **Local only.** Same Wi-Fi or the phone's own hotspot. No cloud relay, no outside service.
- **Encrypted in the app.** The local network is plain HTTP, so every message after the handshake
  is AES-256-GCM encrypted with keys only the two devices hold.
- **Nothing else opens.** Turning the link on makes the stream server listen on the network, but
  for requests from another machine only `/health`, `/link` and the redundancy peer answer while
  the stream server's own "LAN" switch is off. Stream pages, the web remote and file routes stay on
  `127.0.0.1`.
- **Keys stay on the machine.** The desktop's identity key and each phone's device key live in
  `phone-link.json` in the app data folder, sealed with the operating system's protection
  (Electron `safeStorage`). They are not part of `settings.json`, full backups or redundancy sync.

## Transport

WebSocket at `ws://<pc>:<stream port>/link`. Handshake messages are JSON text frames. After the
session starts every frame is binary:

```
[ 8-byte counter, big endian ][ ciphertext ][ 16-byte GCM tag ]
nonce = direction (4 bytes: "c2p\0" phone→PC, "p2c\0" PC→phone) || counter
additional data = nonce
```

Each direction has its own key and its own counter. A frame whose counter is not greater than the
last accepted one is dropped (replay); a frame that fails authentication is dropped and does not
advance the counter. At most 8 phones can be connected at once; at most 120 requests per second
per phone are processed.

Encoding: `b64u` is base64url without padding. Public keys are uncompressed P-256 points
(65 bytes, `0x04 || X || Y`). `HMAC` is HMAC-SHA256, `H` is SHA-256, `HKDF` is HKDF-SHA256.
Strings in MACs are UTF-8, concatenated without separators in the order shown.

## Discovery

While the link is on and "Visible on the Network" is checked, the desktop broadcasts every two
seconds to UDP port 47821 (`255.255.255.255` and each IPv4 interface's broadcast address):

```json
{ "sv": "sv-link", "v": 1, "id": "<pc id>", "name": "<computer name>", "port": 8722 }
```

The announcement carries nothing secret. Pairing still needs the QR code or the code.

## Pairing

The desktop has a long-term P-256 identity key. `Add Phone` opens a pairing window for two minutes:
a six-digit code and a 32-byte single-use secret. **Every new device needs approval on the desktop,
on both paths**: a QR code that is photographed or visible on a streamed screen is not enough on its
own. Five wrong codes from one address close that address for the window; the window is replaced
only after 30 wrong codes in total, so another host on the network cannot keep rotating the user's
code. A wrong QR secret is refused without touching the window (32 random bytes cannot be guessed).

The QR code carries:

```
svlink://1?h=<address>[&h=<address>…]&p=<port>&id=<pc id>&f=<fingerprint>&s=<secret>&n=<name>
fingerprint = b64u( H("sv-link-fp" || pcPub)[0..16] )
```

On connect the desktop sends `{ "t": "hello", "v": 1, "pc": { "id", "name", "pub" }, "pairing": bool }`.

### With the QR code

The phone proves it read the QR code; the desktop proves it holds the key in the QR code; the user
approves on the desktop.

```
phone → { t:"pair", kind:"qr", v:1, pub, np, name, model, mac: HMAC(secret, "sv-link-qr|phone|" || devPub || np) }
PC    → { t:"pending", nc, pc:{ id, name, pub }, mac: HMAC(secret, "sv-link-qr|pc|" || pcPub || nc || devPub) }
        the desktop shows the phone's name and the six digits (computed as below); the phone may show them too
PC    → { t:"paired", device, level, pc:{ id, name } }        after approval
```

The phone checks `fingerprint(pc.pub)` against the QR code and verifies `mac` as soon as `pending`
arrives. The secret is burned once a device is enrolled.

### With the code (when the QR code cannot be read)

Numeric comparison with commit-before-reveal, as in Bluetooth Secure Simple Pairing:

```
phone → { t:"pair", kind:"code", v:1, pub, name, model, proof: HMAC(code, "sv-link-code|" || devPub) }
PC    → { t:"commit", pub: pcPub, commit: HMAC(nc, "sv-link-commit|" || pcPub || devPub) }
phone → { t:"reveal", np }
PC    → { t:"reveal", nc }            phone checks the commitment
both show  SAS = uint32_be( H("sv-link-sas" || devPub || pcPub || np || nc)[0..4] ) mod 1 000 000
user compares the six digits and approves on the desktop
PC    → { t:"paired", device, level, pc:{ id, name } }
```

The desktop commits to its random value before it sees the phone's, and the phone reveals its value
before it sees the desktop's. Someone in the middle has to choose both of their values before
learning the other side's, so the two screens show the same number with probability one in a
million per attempt. A rejected or failed pairing counts as a failed attempt. The code itself only
gates who may start a pairing; a code learned by listening on the network is not enough, because
the person at the desktop must still approve a matching number.

### Device key

Both paths end with the same derivation:

```
shared  = ECDH(devPriv, pcPub) = ECDH(pcPriv, devPub)
devKey  = HKDF(shared, salt = np || nc, info = "sv-link-device|" || b64u(H(devPub || pcPub)), 32)
device id = b64u( H("sv-link-id" || devPub) )[0..16]
```

A phone that pairs again with the same key replaces its old record. New devices start with
**full** access (the user can lower it in the device list).

## Session

Every connection, including the one that just paired, uses fresh random values:

```
phone → { t:"resume", v:1, device, np, proof: HMAC(devKey, "sv-link-resume|phone|" || np) }
PC    → { t:"welcome", nc, level, pc:{ id, name }, proof: HMAC(devKey, "sv-link-resume|pc|" || np || nc) }
keys:   c2p = HKDF(devKey, np || nc, "sv-link-session|phone-to-pc")
        p2c = HKDF(devKey, np || nc, "sv-link-session|pc-to-phone")
```

Right after pairing the session starts with the pairing's `np` and `nc`. A forgotten device gets
`{ t:"error", code:"unknown-device" }`. The handshake must finish within 15 seconds (plus 90 seconds
while the desktop waits for number approval).

Encrypted messages:

```
phone → { id, op, args }
PC    → { re: id, ok: true, result } | { re: id, ok: false, error }
PC    → { ev, … }                         event pushed to every session
```

Errors: `not-allowed` (the device's level does not include the operation, or the operation is not
known), `unsupported` (allowed, not implemented in this version), `bad-args`, `standby` (this copy
is a redundancy backup following its primary: only `view` operations run), `busy` (a self-test is
holding writes), `panel-closed`, `failed`. A settings patch also returns `path`, `type`, `too-big`,
`needs-pc`, `locked` or `scene`, with `detail` naming the refused top-level key. A request over the rate limit (120 a
second) gets `rate`.

## Operations

Network operations are absolute: "blackout on" instead of "toggle blackout", so a retried request
or two phones pressing at once cannot flip a state the wrong way. Validation is in
`src/main/link-live.js` (live control) and `src/main/link-guard.js` (settings). The desktop panel
applies every change through its own code (`src/admin/link-live.js`): the panel stays the only
writer, so the phone and the panel do not overwrite each other, and undo and redundancy behave as
for a change made in the panel.

| Operation | Arguments | Level |
|---|---|---|
| `state.get` | | view |
| `config.get` | → `{ rev, config }` without this machine's keys (`stream`, `mcp`, `phoneLink`, `redundancy`, `bridge`, `mqtt`, `updates`) | view |
| `live.get` | → `{ meter, show }` | view |
| `scene.apply` | `{ id }` | control |
| `cue.set` | `{ id }` (empty clears the cue) | control |
| `blackout` | `{ on }` | control |
| `tbar` | `{ v }` 0..1 lever position, or `{ take: true }` | control |
| `master.set` | `{ v }` 0..1 | control |
| `mixer.set` | `{ layer, opacity }` or `{ layer, enabled }`, layer from 1 | control |
| `momentary` | `{ list }` the effects the phone holds: `flash`, `strobe`, `blur`, `kaleido`, `glitch`, `negative` | control |
| `deck.trigger` | `{ row, col }` | control |
| `deck.stop` | `{}` all, or `{ col }` | control |
| `macro.set` | `{ i, v }` macro 0..7, value 0..1 | control |
| `tempo.set` | `{ bpm }` 0 = follow the music, otherwise 30..200; taps are timed on the phone | control |
| `tempo.tap` | `{}` one tap timed on the desktop | control |
| `autovj.toggle` | `{ on }` | control |
| `milkdrop.nav` | `{ dir }` `next`, `prev`, `random` | control |
| `timeline.transport` | `{ action }` `play`, `pause`, `stop`, `next`, `prev` (markers), or `{ action: "seek", t }` | control |
| `run` | `{ id }` a named action from `src/main/remote-commands.js` | control |
| `config.patch` | `{ patch, final }` changed top-level keys; `final: false` while dragging | edit (output, audio, lighting and power keys: full) |
| `scene.create` | `{ name, data? }` without data: the desktop's current look | edit |
| `scene.save` | `{ id, data? }` | edit |
| `scene.rename` | `{ id, name }` | edit |
| `scene.delete` | `{ id }` | edit |
| `scene.reorder` | `{ ids }` every scene id once | edit |
| `palette.save` | `{ name, colors? }` 2 to 5 `#rrggbb` | edit |
| `palette.delete` | `{ id }` | edit |
| `preview.get` | → `{ width, height, jpeg }` the frame an output shows, 480 px wide, base64 JPEG | view |
| `audio.watch` | `{ on }` stream the desktop's audio to this phone (see below) | view |
| `audio.bridge` | `{ on, fallback? }` make this phone's audio the desktop's audio input | full |
| `output.list` | → `{ displays, open, floating, selected }` | view |
| `output.open` | `{ ids? }` display ids from `output.list`; without ids the saved selection | full |
| `output.close` | `{ id? }` one display, or all | full |
| `output.set` | `{ floating }` open or close the floating window | full |
| `audio.sources` | → `{ devices, sources, phone }`; the choice itself is `config.patch { audio }` | full |
| `record.start`, `record.stop` | | full |
| `export.start` | `{ audio, format?, resolution?, fps?, quality? }` `audio` is the id `file.end` returned for a song (`kind: "audio"`); the video goes to this computer's Videos/SoundVisualizer folder | full |
| `export.cancel`, `export.status` | progress also arrives as `{ ev:"export", p }` | full |
| `library.list` | `{ kind, q?, offset?, limit? }` `video`, `logo`, `lyrics` or `milkdrop` → `{ total, items:[{ id, name }] }` (no paths) | view |
| `thumb.get` | `{ kind, type }` `visualizer` or `background` mode thumbnail → `{ type, data }` base64 | view |
| `milkdrop.load` | `{ id }` a preset id from `library.list` | control |
| `file.begin`, `file.chunk`, `file.end`, `file.cancel` | see Files | full |
| `nowplaying.set` | `{ has, title, artist, album, position, duration, playing, artwork? }` the track playing on the phone; seconds; artwork a JPEG/PNG/WebP data URL up to 192 KB, sent only when the track changes | full |

Momentary effects are a lease: the phone resends its held list about every half second and the
desktop drops it 1.5 seconds after the last refresh, and at once when that phone's session closes,
so a lost release or a dropped connection cannot leave an effect on the output. The lease is kept in
the main process: a refresh only updates a timestamp, and the panel is called only when the combined
list of all phones changes. The phone's held effects are kept apart from the ones held in the panel.

Settings patch rules (`link-guard.js`): only listed keys; the scene list, control bindings and this
machine's keys are never writable; values keep their type; numbers are finite and clamped to the
slider ranges (layer settings too); **a path-like string must already exist in this machine's
settings**, so the phone can reuse a library file but cannot point the desktop at a new file; web
pages and video inputs (Spout, NDI, screen, camera) are edited, added and removed at the desktop only
(the phone may turn them on or off, change their opacity and move them); a locked layer is
not removed or moved unless the patch unlocks it.

Events:

```
{ ev:"config", rev, patch }   changed top-level keys; a phone that misses a revision calls config.get
{ ev:"meter", meter }         level, bands, BPM, beat; at most five times a second, when it changes
{ ev:"live", show }           active scene, cue, T-bar { rest, p, live }, blackout, held effects,
                              timeline { playing, time }, playing clip deck cells ("row:col,…"),
                              MilkDrop preset name; when it changes
```

Events and the mirror run only while a phone session is open.

## Audio

Audio travels as binary messages inside the encrypted session. JSON messages start with `{`; an
audio packet starts with its kind byte:

```
[u8 1 = PCM][u8 version 1][u32 BE sequence][u32 BE sample rate][u8 channels 1|2][s16 LE samples]
```

At most 8192 samples per channel per packet, 400 packets a second and 64 KB per packet. There is no
reply. Validation is `src/main/link-audio.js`.

**Phone → desktop (`audio.bridge`, full level).** The phone sends the audio it plays, records or
captures. The desktop builds its analysis frames from it with the same code the capture helper uses
(`src/shared/audio-spectrum.js`, `src/main/audio-frame.js`), one frame per 1/60 s of audio, so
visuals, lighting, OSC, tempo and MilkDrop react as they do to a local input. Raw audio was chosen
over sending analysis frames: 48 kHz stereo 16-bit PCM is about 192 KB/s, a 7174-byte frame sixty
times a second about 430 KB/s, and with raw audio the desktop's own analysis finds the tempo. The
input switch is the audio bridge's (`src/main/bridge-input.js`): the input moves to the phone once
frames arrive, and when the phone goes quiet for 0.6 s the desktop falls back to its local input
(unless that is turned off). Local capture is stopped while the phone's audio is in use. Settings:
`phoneLink.audioIn { enabled, device, fallback }`; `device` empty means any phone, and `audio.bridge`
sets it to the phone that asked. If two phones send, the first one is used until it goes quiet.

**Track information.** While the phone's audio is the desktop's input, the track playing on the
phone (title, artist, album, position, duration and cover, `nowplaying.set`) is the desktop's "now
playing" too, as with the audio bridge: the track info layer, lyrics lookup, the OBS page and OSC see
the phone's track. When the input falls back, the desktop's own track returns.

**Desktop → phone (`audio.watch`, view level).** The phone asks for the desktop's audio to draw the
desktop's settings with its own engine (smooth preview, or the phone as an extra display). The
desktop sends the capture helper's raw audio in the same packet format; a phone whose socket queue
is over 256 KB skips packets instead of building up delay. While a phone watches, the desktop keeps
capturing even if no output window is open. Only the first audio source is sent, and nothing is
sent while the desktop's input is the network bridge or a phone.

## Files

A phone sends a file in parts: `file.begin { kind, name, size }` → `{ id, chunk }`, then
`file.chunk { id, at, data }` in order (`at` is the bytes received so far, `data` base64, at most
96 KB raw), then `file.end { id, sha256 }`. `src/main/link-upload.js` writes only into the app's own
`link-uploads` folder; the name is only a display name (separators, control characters and `..`
are removed, the extension is kept). Limits per kind:

| Kind | Extensions | Up to | Goes to |
|---|---|---|---|
| `video` | mp4, webm, mkv, mov, m4v | 512 MB | media library |
| `logo` | png, jpg, jpeg, webp, gif, svg | 24 MB | logo library |
| `lyrics` | lrc, txt, srt, vtt | 1 MB | lyrics library |
| `milk` | milk, milk2 | 1 MB | user presets (MilkDrop) |
| `audio` | mp3, m4a, aac, wav, flac, ogg, opus | 512 MB | kept for `export.start` (the last three) |

The libraries run their own type and size checks on import. Size and SHA-256 must match at the end.
At most two transfers per phone; a transfer with no part for two minutes is deleted, and so is every
transfer of a phone whose session closes. The folder is emptied when the app starts. The panel
shows a short note when a file arrives (Phone Link → "Notify Me of Changes Made from the Phone",
on by default; the same switch covers settings changes).

## Desktop panel

The top bar shows "Phone connected: name" while a phone is in session, and "audio from the phone"
when its audio is the input; clicking it opens the Phone Link card. The Phone Audio section has a
video delay (0–500 ms) that holds the analysis frames when Wi-Fi jitter puts the picture ahead of the
sound.

**Real image (`preview.get`).** The frame an output window (or the panel preview) shows, as a
480-pixel JPEG, the same capture as MCP `sv_get_preview`. Measured on the desktop: 480×270, about
14 KB.

Handshake error codes: `bad-message`, `protocol`, `timeout`, `pairing-closed`, `bad-secret`,
`bad-code`, `too-many`, `rejected`, `unknown-device`, `expected-encrypted`.

Before the session starts the server accepts only small (4 KB), unfragmented text frames, and drops
a connection whose handshake has not finished in time even if it stays silent. At most eight phone
connections can be open at once.

## Access levels

| Level | Adds |
|---|---|
| `view` | state, preview, library lists, thumbnails |
| `control` | scene changes, blackout, T-bar, momentary effects, clip deck, macros, tempo, Auto VJ, MilkDrop navigation, timeline transport |
| `edit` | settings patches (layers, effects, colors, text, timeline), saving and deleting scenes, presets and color presets |
| `full` | outputs, audio sources, export, recording, lighting, power, sending files, phone audio bridge |

Reserved in the table but not offered from the phone in this version (refused as `unsupported`):
updates, audio repair, MIDI/OSC bindings, redundancy handover and the web layer address, which would
need a confirmation on the desktop.

Never available, at any level: reading or writing arbitrary paths on the desktop, reading stream or
MCP tokens, and changing the phone link's own security settings (approving new devices, opening
pairing). Those happen only at the desktop, so a stolen phone cannot open a new door for itself.
The operation table is `OPS` in `src/main/phone-link.js`; unknown operations are refused.

`phoneLink` in the settings is a machine setting: MCP cannot write it, and importing settings or
restoring a full backup keeps this machine's value. Settings patches from the phone refuse it too.

If the stored keys cannot be read (for example the system key protection is unavailable at that
moment), the link stays closed and the file is left untouched; the panel offers to rebuild the keys,
after which every phone pairs again.

## Panel

Settings → Control → Phone Link: on/off, QR code and code with countdown, number approval (shown on
whatever page the panel is on), paired devices with access level, disconnect and forget, and the
network visibility switch. Windows asks for firewall permission the first time the link listens on
the network; choose "Private networks".
