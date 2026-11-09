# MIDI controller maps and feedback (v4)

MIDI input, MIDI output/LED feedback and every new feature are **off by default**.
Applying a map never changes a hardware mode, asks for SysEx permission, overwrites
an existing binding, or writes a device scene. Existing MIDI learn remains available.

## Setup and safety

1. Enable MIDI and select **one input**, not All, before preparing a device. For
   Launchpad use its **MIDI**, not DAW or DIN, interface; for Push 2 use **User**,
   not Live. Other applications must release that port.
2. Apply the matching map. Bindings remember the selected input ID when one was
   selected. Built-in bindings also reject a different model or wrong port role.
3. Enable feedback separately if desired. Auto output pairs equal port names or
   their directional variants, including Windows `MIDIIN2`/`MIDIOUT2` and Korg
   `SLIDER/KNOB`/`CTRL`. Instance suffixes and interface numbers are preserved.
   Ambiguous naming is **not** guessed. Select the matching output manually if
   the driver presents a different alias. Unknown-role Launchpad ports are not
   used by a built-in map; MIDI learn is the fallback for an unrecognized driver.
4. For APC40 mkII, Launchpad and Push 2, **Prepare Controller** explicitly requests
   SysEx permission, then sends only the temporary mode commands below to one
   matching output. Permission denial sends no mode command; normal MIDI input
   remains available. No automatic preparation occurs on startup, map application,
   enabling feedback or hotplug. The toast says **command sent**, not acknowledged.
5. **Return to Normal Mode** explicitly selects Generic on APC and Live on
   Launchpad/Push. It does not remember/restore a prior custom mode. No palette,
   flash, firmware, calibration, scene or display writes are implemented.

### Korg: required CC scene, not a factory-default claim

The Korg reference makes assignments and channels configurable. Its fixed native
KORG messages use **channel 16**, not channel 1 (§4). We do **not** pretend those
are fixed CC-mode defaults, enter Native mode, or overwrite the user's scene.
Set the following in Korg Kontrol Editor before using **CC setup**:

| Control | Required channel | Required CC | Type / values |
| --- | --- | --- | --- |
| Sliders 1–8 | 1 | 0–7 | CC, lower 0 / upper 127 |
| Knobs 1–8 | 1 | 16–23 | CC, left 0 / right 127 |
| Solo 1–8 | 1 | 32–39 | CC, Momentary, off 0 / on 127 |
| Play / Stop | 1 | 41 / 42 | CC, Momentary, off 0 / on 127 |
| Previous / next marker | 1 | 61 / 62 | CC, Momentary, off 0 / on 127 |
| Previous / next track | 1 | 58 / 59 | CC, Momentary, off 0 / on 127 |

Set group and transport channels to 1 (or Global with Global = 1), Control Mode =
CC, LED Mode = **External**. Only Solo and Play/Stop have feedback in this map.
Knobs, sliders, marker and track buttons have no LED feedback. In Internal LED
mode the device shows its button state rather than the application's target
state. A modified scene must be configured to match or mapped with MIDI learn.

## Protocol audit and references

Official references opened on 9 November 2026; documentation is linked, not copied
into this repository. MIDI channels below are **1-based**; manufacturer tables
using channel 0 mean our channel 1. Only the listed subset is implemented.

### Korg nanoKONTROL2

- [MIDI Implementation Rev 1.00, 2010-12-14, official download](https://www.korg.com/us/support/download/manual/0/159/2710/)
  ([TXT](https://cdn.korg.com/us/support/download/files/aeb2862daf0cb7db826d8c62f51ec28d.txt)):
  §1-1 CC/notes, §3 configurable scene and Native mode, §4 fixed Native controls.
- [Parameter Guide E](https://www.korg.com/us/support/download/manual/0/159/1913/):
  pp. 4–9 document configurable channel, CC number, ranges, momentary/toggle,
  On/Off Value and External LEDs. p. 11 names SLIDER/KNOB and CTRL ports.
- Conclusion: CC mode is supported **only under the explicit scene requirements
  above**. Unconfirmed factory-default behavior was removed from the claim.
  No Korg SysEx is sent. An incoming button press is not proof its External LED
  already lit: the app still sends the required On/Off CC value.

### Akai APC40 mkII

- [APC40 Mk2 Communications Protocol v1.2](https://cdn.inmusicbrands.com/akai/attachments/apc40II/APC40Mk2_Communications_Protocol_v1.2.pdf):
  p. 3 USB port; pp. 10–12 modes and introduction; pp. 13–22 LEDs, palette;
  pp. 23–28 controller updates/rings; pp. 29–37 input assignments.
- Track faders: CC 7 on channels 1–8. Top track knobs: CC 48–55 on channel 1
  (not device knobs 16–23, whose track channel varies in Generic mode).
  Master fader: CC 14, channel 1. Bottom clip row: notes 32–39, channel 1.
  Scene buttons: notes 82–86; Stop All: note 81; Play: note 91.
- Preparation: `F0 47 7F 29 60 00 04 42 04 00 00 F7` selects Alternate Ableton,
  making buttons momentary and LEDs host-controlled; `40` in place of `42`
  returns to Generic. Version triplet is application 4.0.0, not a firmware write.
  CC 56–63 value 1 sets the eight track rings to Single style. Ring values use
  CC 48–55, 0–127. Faders are not motorized and receive no preset feedback.
- RGB clip/scene LEDs: channel 1 static, palette 5 (red in reference), 0 off.
  Play: note 91, 127 on / 0 off. Stop All has **no LED**, so no feedback is sent.
  True Note Off with nonzero release velocity is a release, never a press.

### Novation Launchpad Mini MK3 / X / Pro MK3

- [Mini MK3 Programmer's Reference](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Launchpad%20Mini%20-%20Programmers%20Reference%20Manual.pdf):
  pp. 6–8 interfaces/modes; p. 10 grid; pp. 11–13 palette and MIDI LEDs.
- [X Programmer's Reference](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/Launchpad%20X%20-%20Programmers%20Reference%20Manual.pdf):
  MIDI interfaces, Programmer/Live switch, Programmer layout and MIDI LED examples.
- [Pro MK3 Programmer's Reference](https://fael-downloads-prod.focusrite.com/customer/prod/s3fs-public/downloads/LPP3_prog_ref_guide_200415.pdf):
  p. 6 three interfaces; pp. 8–11 LEDs; pp. 18–19 Programmer mode and grid.
- Shared mapped subset: bottom pads notes **11–18**, top buttons **CC 91–98**,
  channel 1. Every variant's grid was inspected; older Mini/Pro models are not
  matched. Mini/X: second interface is MIDI, first DAW. Pro: first MIDI, second
  DIN, third DAW. DIN/DAW interfaces are excluded.
- Preparation: `F0 00 20 29 02 mm 0E 01 F7`, where `mm` is `0D` Mini, `0C` X,
  `0E` Pro. Final mode `00` returns to Live. These model IDs are **not interchangeable**.
- Both CC buttons and note pads use palette index **5** on / **0** off on channel
  1 (static). The generic CC 127 brightness assumption is not used for buttons.

### Ableton Push 2

- [MIDI and Display Interface Manual Rev 1.1, 2017-01-24](https://github.com/Ableton/push-interface/blob/main/doc/AbletonPush2MIDIDisplayInterface.asc):
  MIDI Interface Access / Port Names, MIDI Mode, LEDs / Default Color Palettes,
  Buttons, Pads, Encoders and Appendix A implementation chart.
- Bottom row pads notes **36–43**, channel 1. Eight track encoders **CC 71–78**,
  channel 1, **7-bit two's complement**, not absolute values. +1 is `01`, -1 is
  `7F`. Encoders have no LED ring feedback and never receive their input delta.
  Play is **CC 85**, not a note; feedback uses CC 85, 127 on / 0 off.
- Preparation: `F0 00 21 1D 01 01 0A 01 F7` selects User. Mode `00` returns to
  Live; no Dual mode is used. The User button alone does **not** switch MIDI mode
  without a host sending this command. Push powers up in Live mode.
- User port aliases explicitly documented by Ableton: Windows `MIDIIN2 (Ableton
  Push 2) nn` / `MIDIOUT2 (Ableton Push 2) nn`, macOS `Ableton Push 2 User Port`,
  Linux `Ableton Push 2 nn:1`. Live/`:0` are excluded. Matching preserves `nn`.
- Pad feedback: channel 1 static, palette index **126** on / 0 off. Index 126 is
  green in the reference palette, not a promise about a modified device palette.
  Display, touchstrip, aftertouch configuration and palette writes are not included.

## Changes found by the audit

- Replaced the shared generic note/CC LED assumption with each controller's
  documented message type and palette values, excluding nonexistent LEDs.
- Fixed Windows IN2/OUT2 and Korg SLIDER/KNOB vs CTRL output pairing; recognized
  compact Novation USB names. Do not broadcast every preset to every output.
- Restricted templates to matching models/roles and selected input IDs.
- Added explicit transient mode preparation; Push in default Live mode was not
  usable simply by asking the user to press User. No automatic SysEx was added.
- Removed the Korg factory-scene assumption. Marker actions use the dedicated
  61/62 requirements instead of labelling rewind/fast-forward 43/44 as markers.
- Kept feedback caches per output; reconnect resends state. Host LED echoes are
  filtered by exact packet, paired source and a bounded 100 ms, single-use window;
  a physical input is not itself treated as proof a preset LED was updated.
  A failed send does not poison the retry cache.

## Verification and remaining uncertainty

`tests/midi-device-protocols.test.js` drives the real `control.js` in a VM with
mock Web MIDI ports and independent expected vendor tables: 6 variants × 3 OS
naming fixtures, every mapped control, numerical range conversion, mode/restore
packets, CC and note LEDs, output echoes, permission denial, wrong/ambiguous ports,
nonzero Note Off release velocity, no-output-when-disabled, hotplug, instance
suffixes, and two-model output isolation. Existing feedback and relative-encoder
tests also run. Korg/Akai OS alias examples and Novation ALSA/Windows wrappers are
**synthetic driver naming fixtures**, not vendor guarantees for every OS version;
only Ableton provides the full platform name table. Manual output selection is
available rather than silently guessing an unknown pairing.

This establishes protocol conformance and regression safety under the stated
setup. **Not certain for every real device**: no physical controller, USB driver,
modified Korg scene or custom palette was exercised. A fake cannot prove firmware
behavior, OS permissions, USB latency or exclusive-port behavior alongside a DAW.
Exact identical physical events inside an echo window are intrinsically
indistinguishable from a loopback; keep virtual MIDI routing loop-free. Nothing
unused changes the existing application or automatically commandeers a device.
