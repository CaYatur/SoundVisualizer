# Phone link protocol

The SoundVisualizer Android app can run a desktop copy of SoundVisualizer over the local network:
scenes, layers, the timeline, live control, outputs, and the phone's audio. This page describes
the wire protocol and the security model. Status: pairing, encryption, device management and the
first request (`state.get`) ship first; the other operations are added step by step (issue #1054).

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
known), `unsupported` (allowed, not implemented in this version), `failed`.

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
| `full` | outputs, audio sources, export, recording, lighting, power, sending files, web layer address, phone audio bridge; with a confirmation on the desktop: updates, audio repair, MIDI/OSC bindings, redundancy handover |

Never available, at any level: reading or writing arbitrary paths on the desktop, reading stream or
MCP tokens, and changing the phone link's own security settings (approving new devices, opening
pairing). Those happen only at the desktop, so a stolen phone cannot open a new door for itself.
The operation table is `OPS` in `src/main/phone-link.js`; unknown operations are refused.

`phoneLink` in the settings is a machine setting: MCP cannot write it, and importing settings or
restoring a full backup keeps this machine's value. Settings patches from the phone must refuse it
as well.

## Panel

Settings → Control → Phone Link: on/off, QR code and code with countdown, number approval (shown on
whatever page the panel is on), paired devices with access level, disconnect and forget, and the
network visibility switch. Windows asks for firewall permission the first time the link listens on
the network; choose "Private networks".
