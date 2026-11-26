# Decisions

Decisions from the recorded authoring rounds and from the existing v1 runtime. Open questions stay open until they are accepted with the rest of this design.

## Decided (proposed)

These are the recommendations to freeze if the epic is accepted. They are not yet runtime behaviour.

### D1 — Three-level language

v2 is declarative blocks, then short expressions, then a GLSL escape hatch. The escape hatch compiles through the **existing** shader host. There is no second GLSL runtime.

### D2 — Start from a small block catalogue

The recorded bench used 12 blocks. That size is the right starting schema for small models. The catalogue should grow in steps toward blocks the product already knows (modes, post-effects, 3D, text, media). A 30-block schema is a later goal, not the first schema we constrain qwen3.5:4b to.

### D3 — Schema plus a semantic validator

A JSON Schema is required, and it is not enough. The validator must evaluate expressions, clamp or reject out-of-range results, and check modulation destinations against the target block's fields and ranges. Constrained generation is allowed and useful for syntax; it is not trusted for ranges. The qwen3.5:2b literal `decay: 0.7` case and the recorded expression overflows are fixtures for that validator.

### D4 — Clamp at runtime, warn at load

If an expression can leave the field's range, load-time sampling records a warning and runtime evaluation clamps to the field's min/max. Literal numbers outside the range still fail the schema (they already do).

### D5 — Destinations use a layer name or id

`mod[].dst` in the research schema was `layers.[0-7].[a-z_]+`. That form is a defect. The frozen schema should require a stable layer `id` (and an optional display name) and a destination that names that id, not the array index.

### D6 — Reasoning off for local authoring

The documented default for local models is reasoning off, plus the schema constraint, plus the validator. Reasoning may be tried on a cloud model or in a later bench; it is not the recommended local setting. Reasoning on and high-effort modes caused two 300 s timeouts and empty or truncated bodies, and did not reliably raise quality.

### D7 — Local default model class

From these runs, document a **`qwen3.5:9b` with reasoning off** (best prompt fit, one semantic warning) and a **`gpt-oss:20b` at medium reasoning** (clean, original, slower) as practical local authors. A **`qwen3.5:4b` with reasoning off** is a fast, original, in-range fallback, but missed the tunnel mesh on P1. Do not document sub-4B models, or `qwen3-vl:8b`, as a supported authoring path. The frontier cloud model remains the quality ceiling.

### D8 — Version 1 stays loadable

A v1 `svpreset` or `svpack` file upgrades automatically: `engine: "shader"` becomes a shader block; `engine: "variation"` becomes the closest block or a reserved variation wrapper; ids, authors and controls are kept. Authors who only use Studio shaders are not forced to rewrite.

### D9 — Legacy files stay on the existing engine

A `.milk` file, or a legacy layer inside a package, is played by the legacy engine the app already ships. It is not re-read through the limited parameter-mapping importer on the version 1 preset helper.

### D10 — Package work is shared with the existing pack-format issue

The working zip layout (`preset.json`, `shaders/`, `assets/`, `preview.jpg`) must be reconciled with the open issue **Pack format v2 with dependencies and versioning**. This research does not open a second pack-format epic, and it does not close that issue.

### D11 — Public naming

Research pages, issue comments, and result tables use the **real local model names** that were tested, including reasoning mode and effort. The cloud baseline is called **frontier cloud model**. The generating software is called a **local inference runtime**. Competing applications are not named.

### D12 — Expression and modulation order

Proposed evaluation order, to be implemented with the interpreter: evaluate the field's expression (or take the literal), apply document-level modulation routes, then clamp to the field's range. Scene-level modulation in the existing panel remains a separate, later-applied step and is documented as such.

### D13 — Few-shot copying is a scoring defect

A schema-valid document that closely reuses the few-shot examples must not score above 3. In these rounds, those documents scored 2. Later prompts should say not to copy the examples verbatim, and the bench should flag overlap automatically.

## Open

- Exact tokens for `kick` vs `beat` vs the host's beat pulse, and whether `energy` is the same as the host's level.
- The definition of `smooth` (one-pole follow, and whether it takes a second argument).
- Division by zero: return 0, or the field default.
- Clamp-and-warn vs reject-on-load for expressions that can leave the range (D4 is the proposal; it can still be changed before the format is frozen).
- How many blocks the first shipped schema should contain, and which of the existing modes and post-effects are in that first cut.
- Package field names and an app-version range, pending a review against the existing pack-format issue.
- Whether a standalone MIT player package is part of the first implementation slice (it is a format goal, not a requirement of the research docs).
- A visual (rendered) score next to the structural score, once a shortlist of saved presets can be played back.
- Whether YAML is in the first shipped loader or a later nicety.

## Non-goals

- Replacing `docs/SHADER-GUIDE.md`, `docs/MODULATION-COOKBOOK.md`, or `docs/BENCHMARKS.md`.
- A marketplace or storefront (a separate, deferred issue already exists).
- Closing the existing custom-font issue; typography assets stay there.
- Merging, tagging, or shipping any of this without a separate, explicit approval.
