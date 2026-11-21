# MilkDrop 2 reference comparison harness

This folder holds **our** tools for checking CAYADEV Visualizer's MilkDrop engine
frame by frame against a reference renderer built from
[BeatDrop](https://github.com/mvsoft74/BeatDrop)'s MilkDrop 2 sources
(commit `53d83ee29841e0ae11bc4bd85f67cb09594762a2`, BSD-3).

BeatDrop's sources, Microsoft D3DX, compiled binaries and rendered frames are
**not** in the repository. `setup.js` fetches the pinned BeatDrop commit, copies
only `vis_milk2` and `ns-eel2` into a local working tree, applies our measurement
patches, fetches the official Microsoft D3DX NuGet package, and builds `bin/mdref.exe`.

The compile-rate and live-image harnesses (`scripts/milkdrop-compile-rate.js`,
`scripts/milkdrop-render-rate.js`) are separate and already lived under `scripts/`.

## Requirements

- **Windows** to build and run the reference renderer (Direct3D 9). Fetching
  sources works on any OS (`node setup.js --skip-build`).
- **Node.js** (the same major version you use for the app).
- **Visual Studio Build Tools** with the C++ x86 (`vcvars32.bat`) toolset.
  2019 or later is fine. You can point at a specific environment with `VCVARS`.
- A network connection the first time, to download BeatDrop and
  `Microsoft.DXSDK.D3DX` 9.29.952.8 from nuget.org.
- A checkout of this repository with `npm install` already done (`electron` and
  `sharp` come from the repo's `node_modules`).
- A GPU / D3D9 device to run `mdref.exe`. This is an offline local tool; it is
  **not** run in CI.

Optional environment variables:

| Variable | Meaning |
|---|---|
| `VCVARS` | Full path to `vcvars32.bat` |
| `DXSDK` | Root of the D3DX SDK (`…/build/native`) if you already have it |
| `SV_REPO` | Path to this repository (defaults to two levels above this folder) |
| `REPO` | Same, for the shell drivers |
| `PRESETS` | Folder of `.milk` files (defaults to `synth/` for the shell drivers) |
| `MDREF_MVFIX` | Set to apply the #750 motion-vector read fix in the reference build |
| `MDREF_ERRLOG` | File path; MilkDrop `dumpmsg` lines (shader errors) are appended there |
| `OURS_MV` | Our engine's motion-vector mode (default `fixed`) |

## Setup

From the repository root:

```bash
npm run milkdrop-ref:setup
```

or:

```bash
node scripts/milkdrop-ref/setup.js
```

`--skip-build` stops after fetch and patch. On Windows you can also run
`scripts/milkdrop-ref/build.bat` once the sources and D3DX are in place.

The script will write (all gitignored):

- `src/vis_milk2/` and `src/ns-eel2/` — BeatDrop trees at the pinned commit, with our patches
- `d3dx/` — unpacked Microsoft D3DX package
- `bin/mdref.exe` — the reference renderer

Our own host is `src/mdref.cpp`. Our patches (`patch.js`, `patch-mvfix.js`,
`patch-errlog.js`) are applied only to that working copy: a fixed 30 fps clock,
a frame-capture hook before `Present`, an optional motion-vector fix, and an
optional error log. With those flags off, the renderer matches stock BeatDrop
`53d83ee`.

## Run

Compare the bundled synthetic scenes (small, written for this harness):

```bash
node scripts/milkdrop-ref/run.js --presets=scripts/milkdrop-ref/synth --frames=60 --cap=59 --name=synth
```

Useful flags (see the header of `run.js`):

- `--presets=` a folder, a single `.milk`, or a JSON list of paths
- `--sample=N --seed=1` to draw a reproducible subset
- `--frames=60 --cap=2,10,30,59` which frames to dump
- `--w=960 --h=720 --audio=tone|silent`
- `--repo=` this checkout (default: the repository root)
- `--skip-md` / `--skip-ours` to reuse frames already in `out/<name>/`
- `--jobs=N` to render presets in parallel
- `--warm=N` to run N blank frames first (matches MilkDrop load timing when needed)

`ours.js` is launched automatically and drives our engine with the same preset
text, the same 576+576 signed 8-bit samples per frame (`audio.js`), a fixed
30 fps step, and a 64×48 mesh.

Third-party corpus packs are **not** shipped. To replay a measurement on your
own library:

```bash
PRESETS=/path/to/presets node scripts/milkdrop-ref/run.js --presets="$PRESETS" --sample=150 --seed=23 --frames=60 --cap=2,10,30,59 --name=corpus
```

The `round*.sh` and `*summary.js` drivers are optional examples of earlier
measurement rounds. They take `REPO` / `PRESETS` from the environment and no
longer contain machine-specific paths. Sets such as `i750set` were third-party
presets and are not included; pass `I750SET` if you still have that folder
locally.

## Scores

`run.js` writes `out/<name>/report.json` and prints a summary. For each captured
frame it compares MilkDrop 2's `f<k>.bgra` (BGRA, top-down) with our
`o<k>.rgba` (RGBA, top-down):

- **`over`** — share of pixels whose R, G or B differs by more than 2/255.
- **`mad`** — mean absolute channel difference, 0–255.
- **`coarse`** — mean absolute difference of 16×16 box averages (0–255). This
  measures layout, not the chaotic pixel-level drift that feedback can amplify.
- **`coarseFlip`** — the same after flipping our frame vertically; a much lower
  value than `coarse` means a UV / orientation mismatch.
- **`lumMd` / `lumOurs`** — rough luminance, for spotting a black or blank frame.

The summary reports median / quartiles of `over` and `coarse` for all comparable
presets and for the subset that uses no user textures and no `rand`. Presets
that need a user texture or call `rand` are flagged in the row list; they are
not expected to match pixel-for-pixel. Side-by-side contact sheets
(`sheet-best.png`, `sheet-worst-*.png`) show MilkDrop 2 on the left and our
engine on the right.

`abcmp.js` and `mvcmp.js` compare two of our own runs (or a motion-vector
subset). They do not replace `run.js`.

Outputs under `out/` are local and gitignored.

## License

Our host, patches, drivers and synthetic scenes are MIT, same as the rest of
this repository. BeatDrop is BSD-3 and is only downloaded at setup time; do not
commit it. Microsoft D3DX is Microsoft's redistributable SDK package and is
likewise fetched at setup, not vendored.
