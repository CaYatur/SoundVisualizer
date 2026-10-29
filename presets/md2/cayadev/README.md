# CaYaDev presets — MilkDrop 2 / BeatDrop variants

MilkDrop 2 compatible copies of CaYaDev presets whose originals in [`../cayadev/`](../../md3/cayadev/) use
MilkDrop 3 features. CAYADEV Visualizer plays the originals; use these files in BeatDrop or another
MilkDrop 2 player.

Each file here stays within MilkDrop 2 limits: q1 to q32, at most four custom waves and four custom
shapes, and no `pw_` samplers. Figures that were separate waves in the original are merged into four
waves, so a few scenes look slightly different from the MilkDrop 3 version.

| Preset | Original |
| --- | --- |
| [CaYaDev - Constellations](CaYaDev%20-%20Constellations.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Constellations.milk) |
| [CaYaDev - Firefly Meadow](CaYaDev%20-%20Firefly%20Meadow.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Firefly%20Meadow.milk) |
| [CaYaDev - Harmonograph](CaYaDev%20-%20Harmonograph.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Harmonograph.milk) |
| [CaYaDev - Harp Strings](CaYaDev%20-%20Harp%20Strings.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Harp%20Strings.milk) |
| [CaYaDev - Night Bloom](CaYaDev%20-%20Night%20Bloom.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Night%20Bloom.milk) |
| [CaYaDev - Smoke Ribbons](CaYaDev%20-%20Smoke%20Ribbons.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Smoke%20Ribbons.milk) |
| [CaYaDev - Spectrum City](CaYaDev%20-%20Spectrum%20City.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Spectrum%20City.milk) |
| [CaYaDev - Tesla Coil](CaYaDev%20-%20Tesla%20Coil.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Tesla%20Coil.milk) |
| [CaYaDev - Twelve Moons](CaYaDev%20-%20Twelve%20Moons.milk) | [MilkDrop 3](../../md3/cayadev/CaYaDev%20-%20Twelve%20Moons.milk) |

Spectrum City crashes BeatDrop 1.5 (its bundled d3dx9_31 compiler faults on the antenna `tall` factor); use [`presets/beatdrop-safe/cayadev/CaYaDev - Spectrum City BeatDrop.milk`](../../beatdrop-safe/cayadev/CaYaDev%20-%20Spectrum%20City%20BeatDrop.milk) there, which drops that factor so antennas blink on every tower.

License: CC-BY-4.0, same as the main pack.
