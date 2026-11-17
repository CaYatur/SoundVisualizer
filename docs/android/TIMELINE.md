# Android timeline — parity with the desktop

Source: the desktop Timeline page (`src/admin/timeline-panel.js`: toolbar, track headers, inspector,
context menu, the "Loop, markers and ruler" section). Data and logic come from shared code:
`src/shared/timeline.js` (model, tempo map, bank, markers, `Transport`),
`src/shared/timeline-edit.js` (split, duplicate, group copy/paste, tempo operations, undo),
`src/shared/timeline-compose.js` (composition, "Use timeline", export job),
`src/shared/showclock.js` (show-clock anchor), `src/admin/modulation-panel.js` `targetCatalog`
(automation targets; it loads without the panel), `src/shared/export-formats.js` (YouTube chapters).
Only the touch surface is phone-specific: `src/mobile/shell-timeline.js` (core and layout),
`shell-timeline-lane.js` (canvas lanes and touch), `shell-timeline-forms.js` (inspector and settings).

Live output works as on the desktop: while "Use timeline" is on, the engine draws the composition at
the playhead on every frame (transitions, opacity, fades, automation and video clips included); while
it is off, the timeline does not touch the manual settings. The playhead reaches the engine through
the same kind of anchor the desktop panel sends (`SVAndroid.showClock`). The one phone-only addition:
when the in-app player has a song, the transport follows it (play/pause/position together; the song
wraps with the loop and stops at a cue).

Status: ✅ available · ◐ available in a different form (explained) · ✗ missing (with the reason)

## Layout

| Screen | Layout |
|---|---|
| Portrait phone | The stage stays visible on top, the timeline is a dock at the bottom (~60% of the screen, ⌃ enlarges it); narrow track headers (color, type icon, M/S/lock/record state); a toolbar that changes with the selection; the inspector is its own page |
| Landscape phone | Side by side: the stage stays visible on the left, the timeline uses the full height on the right (a full-width dock left room for only 2 lanes); ⌃ gives it the full width |
| Tablet (panel ≥ 900 px) | Full width at the bottom; wide headers with the name and M/S/lock buttons; the inspector on the right, next to the lanes |

Touch: tap = select; double tap = inspector (on an empty spot of an automation lane: a point; of a
clip track: a clip); drag a selected clip = move (vertically to another track, dropping below the
last one makes a new track); long press = select and move; edge handles (wide touch areas outside the
clip) = trim; top corners = fade in/out; one finger elsewhere = scroll (with fling); two fingers =
zoom; long press on an empty spot = context menu; tap/drag on the ruler = playhead (snaps to the grid
as on the desktop); a selected marker flag, ♩ tag or loop edge can be dragged. Multi-select with the
"Multi-select" mode (tap, or drag a rectangle on an empty spot).

## Features

| Desktop | Phone | Status |
|---|---|---|
| Several timelines (tabs): new, rename, deactivate/activate, delete, order | Timeline name in the header → menu (move left/right) | ✅ |
| Play/pause, stop and rewind, previous/next marker | Transport row (on narrow screens previous/next are in the toolbar) | ✅ |
| GO and next cue | In the transport row when there is a hold marker | ✅ |
| Time · bar.beat clock | Transport row (+ BPM at the playhead) | ✅ |
| Use timeline (link the output) | Switch in the transport row; while on, a "Timeline" chip on the main screen: open the timeline or go back to manual settings | ✅ |
| While Use timeline is on, the Scene/layer panels edit the clip's local copy (`timeline-target.js`) | "Open scene" on the clip page: goes back to manual settings, applies the scene and opens Layers; updating the scene changes the clip. Clip copies from the desktop are kept and drawn | ◐ |
| BPM / beats per bar (tempo at the playhead) | Settings; the ♩ tag's page | ✅ |
| Tempo change at the playhead, move, delete | Toolbar "♩ Tempo", ♩ tag on the ruler | ✅ |
| Snap: off, bar, beat, half, quarter, 1 s, 0.5 s, frame | Toolbar (magnet) + settings | ✅ |
| Loop on/off, start/end at playhead, by number | Toolbar, edges on the ruler, settings | ✅ |
| Follow playhead | Settings | ✅ |
| Zoom in / out / fit all | Two fingers + toolbar | ✅ |
| Lane height | Settings | ✅ |
| Undo / redo | Header | ✅ |
| Add clip track / automation track | "Add" menu, ＋ in the header column | ✅ |
| Track name, color, mute, solo, lock, opacity, up/down, delete | Track page (on tablets M/S/lock in the header) | ✅ |
| Clip types: scene, template, color preset, visualizer, video, image, shader | Adding a clip (type → source) and the clip page; video from the library or the gallery, image from the gallery | ✅ |
| Action clip (MIDI/OSC actions) | Those with a phone equivalent: blackout, next scene, next/previous visualizer, next color preset, next background, timeline pause/stop/next/previous marker. Clip deck, MilkDrop navigation and redundancy actions live in the desktop control panel (not on the phone); such clips are kept but do nothing | ◐ |
| Clip: name, type, source, target, start, duration, transition time/type/easing, opacity, fade in/out, trim start, speed, color | Clip page | ✅ |
| Split, duplicate, copy, cut, paste (at playhead), delete | Toolbar + context menu | ✅ |
| Multi-select: color, transition, duplicate, copy, delete, move | Multi-select mode | ✅ |
| Move to the track above/below | Toolbar + vertical drag | ✅ |
| Nudge by one grid step (arrow keys) | Toolbar "Back/Forward" | ✅ |
| Magnet while trimming and moving (clip edges, markers, playhead) | While dragging | ✅ |
| Marker: add, name, time, cue (hold), go, delete | Toolbar, marker page, list in the settings | ✅ |
| Create markers from lyrics | Settings (the lyrics layer's cues; otherwise the now-playing song's lyrics from the library) | ✅ |
| Copy YouTube chapters | Settings (clipboard; if it is not available the list is shown to copy) | ✅ |
| Ruler: time and bars / time only / bars only | Settings | ✅ |
| Automation: choose target (search), min/max, path | Track page | ✅ |
| Automation point: add, move, value, segment curve, delete, clear points | Double tap / drag on the lane, point page, context menu | ✅ |
| Automation learn / record | Track page: Learn (the timeline closes, the first setting that changes becomes the target, the timeline reopens), Start recording (manual changes while playing are written as points) | ✅ |
| "With the timeline" in export | Export page | ✅ |
| Keyboard shortcuts | Buttons and gestures on touch | ◐ |

## Tests

`node android/tools/probe.js timeline` (real touches): select, drag snapped to the bar, change track
vertically, trim from the right edge, undo, pinch zoom, context menu on long press, the engine's
composition with Use timeline on (SVShowDebug.time/composed), playback, inspector on double tap,
marker/cue/tempo/loop/markers from lyrics, automation learn and record, export with the timeline
(frames at two moments clearly differ). The layouts were viewed on the emulator in portrait
(1080×2400), real landscape rotation and a `wm size 2560x1600` tablet size.
