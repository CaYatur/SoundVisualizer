# Redundancy: authority, outputs and control (#814)

This page covers phase 3 of the redundancy overhaul (#816): who holds authority, which machine
sends to lights and OSC, what happens when the two machines disagree, how to hand control back,
and how each machine controls and watches the other. The setup guide (wiring, firewall, show-day
checklist) is in the next section of this page once phase 4 (#815) lands.

## Authority in one sentence

Exactly one machine holds **authority**: the primary while the backup follows, or the backup after
it takes over. Authority decides who makes show decisions (Auto VJ, timeline, Clip Deck) and who
sends to the outputs that drive physical lights.

| Role and state | Authority |
|---|---|
| Role off | This machine (redundancy is not running; nothing changes) |
| Primary, just started with the role on | Waiting (fenced) until it has seen the backup's beat, or no backup for twice the loss limit |
| Primary | This machine, unless the backup is active with a newer term |
| Backup, following / lost / connecting | The other machine |
| Backup, active (took over) | This machine |

## Outputs

| Output | Default | With "Always" |
|---|---|---|
| Art-Net | Only with authority | Both machines send |
| OSC output | Only with authority | Both machines send |
| OpenRGB | Only with authority (the connection stays open, updates stop) | Both machines send |
| Dynamic Lighting (Windows) | Only with authority | Both machines send |
| Visual output, Spout/Syphon, overlay and OBS page | Always (not gated) | — |

The picture always runs on both machines: the video switcher decides which one the audience sees.
The gate is computed once when authority changes and read once per meter frame.

When Art-Net loses authority it **holds the last frame** by default (nothing more is sent, so
fixtures do not flash). "Send one black frame" sends a single all-zero frame instead.

## Terms

Every takeover opens a new **term**: one more than the highest term seen. The term is stored in
`<userData>/redundancy/term.json` and never goes down; a new pairing secret resets it, so an old
copy of the file cannot make a fresh pair lose every decision.

- The primary sends its term and whether it holds authority in every heartbeat.
- The backup sends its own beat (`peer-beat`: state and term) every heartbeat.
- A primary that sees the backup active with a newer term steps back: lighting and OSC off, Auto
  VJ and timeline decisions paused, a notice in the panel.
- When the backup hands back or releases, the primary adopts the term and takes authority again.

## Two masters

If both machines act as authority, both panels show **"Two masters"** in red and the pre-show
check fails. It is raised when:

- the active backup receives a primary beat saying "authority here" with a term at least as new as
  its own, or the primary sees the backup active with an equal or older term; or
- the **Art-Net witness** (an optional listener on UDP 6454) sees ArtDmx for our universe from
  another address while this machine is sending.

While the alarm is on, the backup does not take over by itself. Release on one machine or hand
back. The witness only sees broadcast or traffic that reaches this machine; unicast to a node is
invisible to it. Hard fencing of DMX needs a single physical output path or sACN priority, which
this app does not do.

The witness also vetoes automatic takeover: if the backup loses the primary's beats but the
witness still sees the primary sending Art-Net, the network is only split between the two machines
and the backup waits.

## Fenced restart

A primary that starts with the role on (or is switched to primary) does not drive lights or OSC
until it knows the backup's state. A crashed primary that comes back while the backup is active
therefore never sends next to it. Measured: zero packets from the restarted primary.

## Resync

The backup asks for a fresh snapshot and show clock on every return to following (after a
release, a hand-back or a lost-then-back primary). Snapshots carry a revision number. Measured:
the backup matched the primary's live scene 164 ms after Release.

## Hand back to primary

On an active backup: Redundancy → Authority → **Hand Back to Primary**. Every condition is listed
and the button stays off until all hold:

- the primary has been beating for at least 5 s without a gap;
- the shows match (the primary's last comparison reports no differences);
- the clock is synced (at least 20 samples);
- both machines run the same app version.

Switch moment: now, at the next scene change, or at a blackout. At that moment the backup opens a
new term, tells the primary and releases. Measured: 266 ms from the request to the primary
sending alone, with no overlap.

## Two-way control and monitoring

Each machine shows the other: role and state, authority and term, frame rate, audio level, open
outputs, and a small preview (about 320 px, two frames a second, at most about 30 KB each) while
the section is on screen. The preview needs a visualizer window on the other machine.

Show commands (next scene, blackout, next visualizer, timeline play and pause) run on the machine
that holds authority: here if it is here, otherwise they are sent to the other machine, applied
there once (duplicate IDs are ignored) and acknowledged. Redundancy commands (take over, release,
re-arm, hand back, request package) always run on the backup.

## Pairing

The backup no longer sends the secret in the URL. The primary sends a challenge, the backup
answers with an HMAC of it and its own challenge, and the primary proves it knows the secret too.
The secret never goes on the network and the backup will not follow a fake primary. A backup on
the previous version still connects with the old `token=` address for one more release; the
pre-show check warns "Old pairing" until both machines are updated.

## Measured (`npm run failover`, one Windows machine, 100 ms heartbeat)

| Check | Result |
|---|---|
| Art-Net senders while following | 1 |
| Authority moves on manual takeover | 314 ms, overlap 0 ms |
| Backup matches the primary after Release | 164 ms |
| Hand-back with "show differs" | refused, condition named |
| Hand-back | 266 ms, overlap 0 ms |
| Restarted primary while the backup is active | 0 packets |
| Command from the non-authority machine | applied once on the other machine, acknowledged |

## Firewall notes

- **Windows:** allow TCP 8722 (or your streaming port) for the link; UDP 6454 for the Art-Net
  witness. `netsh advfirewall firewall add rule name="SoundVisualizer redundancy" dir=in action=allow protocol=TCP localport=8722`
- **macOS:** allow incoming connections for the app when asked. The app holds an App Nap
  exception while a role is on, so an unfocused backup keeps its timers.
- **Linux:** `sudo ufw allow 8722/tcp` (and `6454/udp` for the witness). Dynamic Lighting is
  Windows-only; its gate does nothing elsewhere.

## Not done in phase 3

- **Bridge witness.** The issue proposed carrying the term through the audio bridge (#813) as a
  third witness. It is not implemented: it would couple the bridge to redundancy, and the bridge is
  optional. The Art-Net witness and the term rules cover the cases this machine can observe.
- **Two-PC network cut.** All measurements above are on one machine (two app copies on loopback).
  A real cable pull, a firewall block of only the link and a hung primary are part of phase 4
  (#815) and its two-PC procedure.
