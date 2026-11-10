# Remote control protocol

This is the contract between SoundVisualizer and anything that controls it over the network: the
built-in phone remote (`src/web/remote.html`), and later a phone app or a show-control panel. A
client that follows this page does not need to read the app's source.

The protocol is local-network only, JSON over one WebSocket, and every command is checked in the
main process before anything is applied. There is no second write path for remote clients: the
`osc` command goes through the same fixed control tree as OSC, MQTT and Companion.

For scripting from the same computer there is also the HTTP API (MCP tools over REST,
`/api/v1/openapi.json`, loopback only). This page is about the stream server.

## Connecting

1. In the app, open **Output → Streaming Output (OBS / Web)** and press **Start Streaming**
   (setting `stream.enabled`). For other devices to reach it, turn on **Open to Local Network**
   (`stream.lan`); otherwise the server listens on `127.0.0.1` only. The remote page can be switched
   off with `stream.remote: false` in the settings file (default on).
2. The section shows two addresses, the overlay and the remote, and the **Mobile Remote Token**. The
   remote address looks like `http://<computer>:8722/remote?token=<remote token>`. The port is
   `stream.port` (default 8722).
3. Open the WebSocket at `ws://<computer>:<port>/ws?kind=remote&token=<remote token>`.

| | |
|---|---|
| `kind` | `remote` for a controller. `overlay` gets audio frames and never sends commands. Any other value is treated as `overlay`. |
| `token` | The **remote** token, not the overlay token. It can also be sent as the `X-SV-Token` header. With **Token protection** on (`stream.requireToken`) a missing or wrong token closes the connection with `401`. |
| Host | Must be an IP address, `localhost`, a bare host name, a `.local` name or the computer's own name. Other names get `403` (DNS rebinding guard). |
| Origin | A browser page must be served from the same host and port. Native apps send no `Origin` and are not affected. |

The two tokens are different on purpose: someone who has the overlay link cannot control the show.
Tokens are never sent to clients inside the configuration.

The connection is plain `ws://`. Do not expose the port to the internet.

## Messages from the app

Every message is a JSON object with a `type`. Most also carry `serverNow` (milliseconds on the
app's clock).

| `type` | When | Fields |
|---|---|---|
| `hello` | First message | `app`, `protocol` (this page's version, now `1`), `kind`, `platform` (`win32`, `darwin`, `linux`), `version` (the app), `serverNow` |
| `config` | After `hello`, then on every full change | `config`: the whole configuration, tokens and passwords removed |
| `config-patch` | While a slider is dragged in the panel | `patch`: only the changed top-level keys; apply on top of the last `config` |
| `presets` | After `config` | `presets`: user presets (MilkDrop entries carry no source) |
| `presets-delta` | When presets change | `delta.upsert`, `delta.remove` |
| `now-playing` | When the track changes | `state`: `has`, `title`, `artist`, `album`, `app`, `artwork` (data URL or empty) |
| `live` | Up to five times a second, only when something changed | `state`: `level`, `bass`, `mid`, `treble` (0–1), `bpm` (0 = unknown), `timeline` (playing), `blackout` |
| `tick` | Once a second | `serverNow`. If nothing arrives for 1.5 s, treat the connection as dead and reconnect |
| `status` | On server-side status changes | free-form; ignore if unused |

Other types (`lyrics-lib`, `lyrics-clock`, `show-clock`, `md-follow`, `momentary-fx`, camera
frames) are for the overlay page; a controller can ignore them.

Useful places in `config` for a controller:

| Path | Meaning |
|---|---|
| `scenes[]` | `{ id, name, data }`; `data` holds the saved scene |
| `_activeSceneId` | The scene last applied |
| `layerStack.enabled`, `layers[]` | The layer list: `id`, `kind`, `type`, `name`, `enabled`, `opacity`. Layer 1 is the bottom of the stack |
| `master` | Master opacity, 0–1 |
| `crossfade.value` | A/B crossfade, 0 (A) to 1 (B) |
| `autovj.enabled` | Auto VJ |
| `isBlackout` | Blackout as last saved by the panel; `live.blackout` is fresher |
| `background.gradient.colors` | The scene palette |
| `ui.theme` | The panel's interface theme (the built-in remote follows it) |

## Commands to the app

A command is `{ "type": "command", "action": "<name>", ... }`. Only `kind=remote` connections may
send them. Anything that fails a check is dropped without a reply; the app's answer is the next
`config` or `live` message.

| `action` | Fields | Effect |
|---|---|---|
| `openVisualizer` | | Opens the output on the displays chosen in the app |
| `closeVisualizer` | | Closes the output windows |
| `blackout` | | Toggles blackout with its transition, exactly like the panel button |
| `scene` | `id` | Applies a saved scene by id; transparency and taskbar settings are kept |
| `set` | `path`, `value` | Writes one setting from a short allow-list (below) |
| `osc` | `path`, `args` | One message on the fixed control tree (below) |
| `run` | `id` | One named panel action (below) |

### `set`

Allowed paths: `_activeSceneId`, `audio.sensitivity`, `audio.smoothing`, `audio.bassBoost`,
`visualizer.*`, `background.*`, `logo.opacity`, `logo.scale`, `logo.pulse`, `power.fpsCap`,
`power.renderScale`, `power.pauseOnSilence`, `custom.visualizerId`, `custom.backgroundId`,
`feedback.*`, `media.opacity`, `media.enabled`, `media.kaleido`, `media.hue`.

Values must be a number, a boolean, a string of at most 64 characters, or an array of at most 8
strings of at most 16 characters. Numbers on known paths are clamped (for example
`audio.smoothing` to 0–0.99, `power.fpsCap` to 0 or at least 10). With the layer stack on,
`visualizer.type` and `background.type` change the visible layer of that kind.

### `osc`

`path` is an address on the fixed control tree **without** the prefix (the app adds its own,
`/cayadev` by default). `args` is an array of up to four numbers, booleans or strings. The app runs
the tree's own planner on it; an address the tree does not know, a wrong argument type or a layer
that does not exist is dropped. Values are clamped to the same ranges as the panel.

| `path` | `args` | |
|---|---|---|
| `show/blackout` | `[0 \| 1]` | Blackout off / on |
| `show/opacity` | `[0–1]` | Master opacity |
| `show/autovj` | `[0 \| 1]` | Auto VJ |
| `show/palette` | `["theme" \| "solid" \| "rainbow"]` | Background colour mode |
| `show/brightness` | `[number]` | Background brightness |
| `show/transition` | `["<id>"]` | Scene transition type |
| `crossfade` | `[0–1]` | A/B crossfade |
| `scene` | `["<name>"]` | Applies a scene by name |
| `visualizer` | `["<id>"]` | Visualizer mode |
| `background` | `["<id>"]` | Background mode |
| `milkdrop/preset` | `["<name>"]` | Loads a MilkDrop preset by name |
| `layer/<n>/opacity` | `[0–1]` | Layer *n* (1 = bottom) opacity |
| `layer/<n>/enabled` | `[0 \| 1]` | Layer *n* on / off |
| `deck/launch` | `[row, col]` | Clip deck cell |
| `deck/stop` | `[1]` | Stops the clip deck |
| `timeline/playing` | `[0 \| 1]` | Pauses / plays the timeline |
| `timeline/stop` | `[1]` | Stops the timeline |

The same tree is what OSC input accepts and what OSCQuery describes; its `RANGE` values are the
ones used here. Mode and transition ids come from `src/shared/mode-catalog.js` and
`src/shared/transition.js`.

### `run`

| `id` | |
|---|---|
| `nextScene` | Next saved scene |
| `nextPalette` | Next colour preset |
| `nextVisualizer`, `prevVisualizer` | Step the visualizer mode |
| `nextBackground` | Step the background |
| `tlPlay`, `tlPause`, `tlStop` | Timeline transport |
| `tlNextMarker`, `tlPrevMarker` | Jump between timeline markers |
| `deckStopAll` | Stops every clip deck cell |
| `mdNext`, `mdPrev`, `mdRandom` | MilkDrop preset navigation |

Redundancy takeover, deck slots and MilkDrop sprites are deliberately not on the list.

## Writing a client

- Keep the last `config` and apply each `config-patch` on top of it; a patch never arrives before
  the first `config`.
- Send at most one message per animation frame while a finger is on a slider, and do not move the
  slider back with the echo until the finger lifts. The built-in remote does both
  (`src/web/remote.js`).
- Reconnect with a short back-off. The page keeps its last state while reconnecting.
- Show what the app reports, not what you sent: a command can be clamped or dropped.

## Stability

`hello.protocol` is the version of this page. It goes up only for a change that breaks existing
clients (a removed command, a renamed field); a client should refuse a value newer than the one it
was written for and say so. New fields and new `osc` addresses can appear without a version change;
ignore what you do not know. The
checks live in `src/main/remote-commands.js` and are covered by `tests/remote-v2.test.js`.
