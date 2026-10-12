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
