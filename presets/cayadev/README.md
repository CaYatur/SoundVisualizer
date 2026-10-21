# CaYaDev MilkDrop Presets

Original MilkDrop presets made for [CAYADEV Visualizer](https://github.com/CaYatur/SoundVisualizer). They are
built into the app, and you can also use them in any MilkDrop-compatible player.

Every preset here was written from scratch (no code from community presets) and checked before it was added:

- **Shaders:** warp and comp shaders; bass, mids and treble each drive something different.
- **Stability:** 90 seconds of looped music without fading to black, washing out to white, or freezing.
- **Speed:** 60 fps at 1080p on an entry-level integrated GPU (measured on an AMD Radeon 610M).
- **MilkDrop 2 match:** MilkDrop 2 presets were rendered in MilkDrop 2 itself (the BeatDrop port) and look the
  same as in CAYADEV Visualizer.
- **Refresh rate:** they look the same at 60 Hz and 144 Hz, because trails fade by time, not by frame count.
- **No extra files:** only MilkDrop's built-in noise textures are used, so no texture pack is needed.

## Presets

| Preset | Category | Format |
|---|---|---|
| Neon Monsoon | liquid | MilkDrop 2 |
| Event Horizon | tunnel | MilkDrop 2 |
| Prism Lattice | geometric | MilkDrop 2 |
| Northern Veil | ambient | MilkDrop 2 |
| Twelve Moons | space | MilkDrop 3 |

**MilkDrop 3** presets use more than four custom waves or shapes, or q33–q64. A MilkDrop 2 player loads only
the first four waves and shapes, so these presets show less there. MilkDrop 3 presets were checked in CAYADEV
Visualizer only; MilkDrop 3 itself was not available for testing.

## Using them elsewhere

Copy the `.milk` files into your player's preset folder:

- MilkDrop 2 / BeatDrop / Milkwave: the `presets` folder next to the player.
- projectM: the preset directory from its settings.

Each file has `PSVERSION=3` (pixel shader model 3.0) and needs DirectX 9.0c-class hardware or newer.

## License

[CC BY 4.0](LICENSE.md): use them anywhere, including commercially, and credit "CaYaDev".
