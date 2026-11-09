# Companion module for SoundVisualizer

A [Bitfocus Companion](https://bitfocus.io/companion) module that drives SoundVisualizer through its fixed OSC tree (`src/shared/osc-tree.js`). It sends plain UDP OSC and has no other runtime dependency than `@companion-module/base`.

This folder is not part of the desktop app build and is not installed by the app's `npm install`.

## Develop / load

```
cd integrations/companion
npm install
```

Then add this folder as a developer module path in Companion (Settings → Developer modules). `npm run package` builds a `.tgz` for import.

See `companion/HELP.md` for the user setup. The OSC encoder (`src/osc.js`) and the action table (`src/actions.js`) do not depend on Companion. The app's test suite runs every action through the real OSC tree (`tests/companion-module.test.js`), so a renamed address fails CI.
