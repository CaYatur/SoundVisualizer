# CaYaDev presets: compatibility copies

This folder holds modified copies made only so a preset runs in MilkDrop 2, BeatDrop, or an older
shader compiler. They are not part of the app's built-in pack. The originals are never changed to
suit them.

- A file with the same name as an original is the MilkDrop 2 reduction: q1 to q32, at most four
  custom waves and four custom shapes, and no `pw_` samplers. Figures that were separate waves in
  the original may be merged, so the picture can differ.
- A suffix names a further player or compiler. `Spectrum City BeatDrop` drops the antenna `tall`
  factor, which crashes BeatDrop 1.5's d3dx9_31 compiler. The plain Spectrum City copy here still
  has that factor and only replaces the `pw_` sampler.

Use these only when the original fails in your player.

MilkDrop 2 originals: [`presets/original/md2/cayadev`](../../../original/md2/cayadev).
MilkDrop 3 originals: [`presets/original/md3/cayadev`](../../../original/md3/cayadev).
Gallery and previews: [`presets/README.md`](../../../README.md).

Licensed CC BY 4.0, same as the originals.
