# Contributing to CAYADEV Visualizer

Thanks for helping. Bug reports, ideas, translations, presets and code are all welcome. You can
write in English or Turkish.

## Reporting a bug or asking for a feature

Open an [issue](https://github.com/CaYatur/SoundVisualizer/issues/new/choose) and pick a form. A
good bug report has:

- the app version (*Installed Version* on the Updates card, or the file name you installed) and
  your OS;
- the audio source (system output, a device, one application, a file);
- the steps that show the problem, what you expected and what happened;
- the overlay's diagnostics card for OBS problems (add `?debug=1` to the overlay address);
- `main-errors.log` from the settings folder if the panel reported an error.

Search the open issues first; the [roadmap](ROADMAP.md) lists what is already planned.

## Security

Please do not open a public issue for a vulnerability. Use **Report a vulnerability** on the
repository's [Security](https://github.com/CaYatur/SoundVisualizer/security) tab, so the report stays
private until a fix is released.

## Working on the code

You need [Node.js](https://nodejs.org/) 20 or newer (CI tests 20 and 22) and Git.

```bash
git clone https://github.com/CaYatur/SoundVisualizer.git
cd SoundVisualizer
npm install
npm start
```

`npm run dev` opens DevTools. The [project structure](README.md#project-structure) section of the
README shows where things live.

### Before you open a pull request

```bash
npm test
```

```bash
npm start -- --smoke --user-data-dir=<an empty folder>
```

- `npm test` runs the unit tests. CI runs them on Windows and Ubuntu with Node 20 and 22, and all of
  them must pass.
- The smoke test runs the real app on your GPU. Give it an empty `--user-data-dir` so it does not
  touch your own settings and presets.
- Add a test with the change. Tests here check answers (a 220 Hz tone comes back as 220 Hz), not
  that lines ran. Engines in `src/shared/` have no DOM, GPU or audio device, so their tests run in
  plain Node.

### Checks for a change that touches the interface or the picture

These run the real app with a temporary profile and do not touch your settings.

| Command | What it does |
|---|---|
| `npm run ui-walk` | Clicks through the panel: layers, undo, search, pages, sections, momentary effects |
| `npm run ui-audit` | Visits every page, shelf tab, layer kind, inspector tab and layer source in both languages, and reports Turkish text in the English interface, clipped labels and console errors |
| `npm run ui-layout` | Measures every page, section and layer tab: text or controls too close to a surface edge, anything spilling out, rows in a section that do not start on the same left edge, old-style borders, words broken across lines. `--size=1000x560` checks another window size |
| `npm run golden -- --software --baseline=<file>` | Compares 107 scenes and templates frame by frame with a saved baseline. If a difference is intended, look at it with `--keep` (writes the videos), say so in the PR, and use the new `golden.json` as the baseline from then on. `--repeat` renders every case twice in one run and fails if the two differ byte for byte |
| `npm run perf` | Frame times, CPU and memory in a real scene. `--low` slows the page and `--config-send` measures settings sends |
| `npm run smoke:packaged` | After `npm run pack:dir`: runs the self-test (with export) in the packaged app, from the archive, with a temporary profile. Run it before a release |

Measure before and after on the same machine, in turn, and look at the process list as well as the
averages. `--low` starts throttling after the window has begun loading, so it says little about how
fast the window opens.

### Where things live in the panel

Every scene is a list of layers, and there is no second path for the picture.

- **Pages** are `CATEGORIES` in `src/admin/admin.js`. The Scene page is `scene-shell.js` and the Live
  page is `live-shell.js`. Other pages draw the cards from `sectionSchema()`. `SECTION_PAGES` sets the
  order on pages that show one section at a time.
- **A layer setting** goes in `src/admin/scene-panels.js`, in `layerOwnSettings` and the functions it
  calls. Search finds it by itself. Give a slider `path` when the schema (`src/shared/schema.js`) has a
  row for it, so extended ranges work, or `extend: true` when it has none.
- **Removing a layer setting** fails `tests/layer-editor-fields.test.js` until its label is also gone from
  `tests/fixtures/layer-labels.json`. That is on purpose: settings have been lost by accident this way.
- **A visualizer or background mode** goes in the mode catalogue, `src/shared/mode-catalog.js`, and its
  settings appear on the layer from there. A new **effect** goes in `src/visualizer/postfx-extra.js` and
  `EFFECT_TYPES` in `src/shared/mcp.js`.
- **Colours** come from `src/shared/ui-themes.js`. Stylesheets use `var(--x)` only, and a test fails on
  anything else.
- **Styles** for the pages are in `src/admin/pages.css`, grouped under a numbered table of contents, and
  shared values are at the top (`--sv-inset`, `--sv-surface`, `--sv-fill`). It loads after `admin.css`,
  `studio.css` and `shell.css`, so a change goes there and not in a new override. A row, note, button or
  module header in a section takes its side spacing from `--sv-inset` and adds none of its own.
- **Something that runs in the background** (a server, a listener, an output) gets `P().moduleHead()`: a
  status line and a start or stop button, not an on/off switch. The config path stays the same, so MCP,
  OSC and saved settings keep working. A small feature inside a section can stay a switch.
- **Long help text** goes in `P().row` hints, which become an info icon, or in a `.studio-note`, which
  shows two lines and a "More" button when it is long.
- **The packaged visualizer page** is generated by `scripts/bundle-pages.js`, and every file on that page
  must start with `'use strict'`. `SV_BUNDLED=1` runs the bundle from source, after you generate it.

### Conventions

- **Commits and pull requests in English**, in the form `fix(scope): what changed`
  (`feat`, `fix`, `docs`, `perf`, `test`). Say what you measured, not only what you changed.
- **Code comments and interface text are in Turkish.** Every new interface string needs its English
  entry in `src/shared/i18n.js`; the smoke test switches the interface to English and fails on text
  left untranslated. If you do not write Turkish, write the English and say so in the pull request.
- **Both READMEs move together.** A change to `README.md` needs the same change in `README.tr.md`.
  Numbers in the README (modes, templates, tests) come from the code, so count them, do not guess.
- **Screenshots are generated**, not taken by hand: `npm start -- --shots --only=<file name>` writes
  to `docs/screenshots`.
- **MilkDrop engine changes** reference [#560](https://github.com/CaYatur/SoundVisualizer/issues/560)
  in the commit message. Behaviour is matched against MilkDrop's own source and measured on presets,
  and the README's MilkDrop notes say what was checked.
- **Do not copy code** from projects whose licence is not compatible with MIT. Reading another
  project to understand a behaviour is fine; describe it in your own words and write your own code.

### Translations

The interface has two languages, Turkish and English. Fixes to the English wording are welcome:
edit the value in `src/shared/i18n.js`, not the Turkish key.

## Licence

By contributing you agree that your work is released under the [MIT licence](LICENSE).
