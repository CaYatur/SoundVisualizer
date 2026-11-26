# Preset format v2 — research

Research notes for a declarative **svpreset version 2** language, and for an AI authoring benchmark against that language. This tree is not the stable author guide, and it does not change the runtime.

Companion issues (to be opened after approval):

- Epic: **Preset format v2: research & AI authoring**
- **AI authoring benchmark**
- **Schema & validator**
- **Expression language**
- **Documentation for AI/humans**

## What v2 is trying to be

A preset that a person or a small local model can write in three levels:

1. **Declarative blocks** in JSON (YAML later): a short catalogue of layers such as gradient, feedback, waveform, particles, mesh, camera, text, and a few colour and style effects.
2. **Short expressions** on numeric fields, for example `"1.01 + 0.03*bass"`.
3. **GLSL** as an escape hatch, compiled by the shader host the app already has.

The working package shape is a zip (`.svp`) with `preset.json`, optional `shaders/` and `assets/`, and `preview.jpg`. Version 1 documents should upgrade automatically. A legacy `.milk` file should load as a legacy layer through the engine that already ships. The zip layout has to be reconciled with the open issue **Pack format v2 with dependencies and versioning**.

## What already ships

Do not read this tree as a proposal to invent the following. They already exist:

- `svpreset` / `svpack` **version 1** in `src/shared/presets.js` (shader and variation engines, JSON packs — a JSON document, not a zip).
- The Studio shader host: audio uniforms, previous-frame feedback, spectrum and waveform sampling, multi-pass comments, and import of common shader-sandbox files. See [`docs/SHADER-GUIDE.md`](../../SHADER-GUIDE.md).
- Scene-level modulation routes. See [`docs/MODULATION-COOKBOOK.md`](../../MODULATION-COOKBOOK.md).
- A full legacy `.milk` engine, used as its own layer, separate from the limited parameter-mapping importer on the version 1 preset helper (that path copies static parameters only).

v2 sits on top of that: a document language weaker models can write, a validator, an upgrade path, and docs.

## Method

1. Publish a small JSON Schema for the declarative document and the expression grammar. The recorded rounds used a **12-block** subset so that a small model could finish a document. The catalogue can grow later toward about 30 blocks.
2. Ask a model to write one preset. The system instruction includes the two example files in `bench/examples/`. When the server can constrain a response to a JSON Schema, that option is turned on. Temperature is 0.3; the completion length is capped.
3. Prompts (see `bench/prompts.json`):
   - **P1** — deep-bass neon tunnel with feedback and kick pulses.
   - **P2** — rotating 3D crystal with bloom, treble reaction, and a slow camera orbit.
4. Score each saved document:
   - JSON parse
   - JSON Schema
   - semantic checks (expression ranges, modulation destinations)
   - few-shot copying (a near-copy must not score above 3; in these rounds those documents scored 2)
   - structural quality 1–5 (rubric below)
   - wall-clock latency
5. Write findings here. Keep the bench in `bench/` so the same two prompts can be re-run after a schema change.

The recorded rounds were single passes on one operator machine, on 26 November 2026 (Europe/Istanbul). Hardware was not written down in the run log. Latency for the frontier cloud model was not recorded. These figures are a first look, not a statistical study.

### Quality rubric

| Score | Meaning |
|---:|---|
| 5 | Schema-valid, prompt-faithful, audio-reactive, in-range expressions and destinations, not a near-copy of the examples, coherent stack. |
| 4 | Schema-valid and prompt-faithful, with only a minor range or destination issue, or a slightly busy stack. |
| 3 | Schema-valid but weak: several range or destination errors, a kitchen-sink stack, incomplete prompt fit (for example a tunnel prompt with no tunnel mesh), or a near-copy of the examples. |
| 2 | Schema invalid, or a heavy few-shot copy, or valid but with broken destinations and a poor fit. |
| 1 | Empty body, invalid JSON, or a timeout. |

Scores in the recorded rounds are structural scores from the saved JSON. They are not ratings of a rendered frame.

### Naming

Local model names are written as they were used (for example `qwen3.5:9b`, `gpt-oss:20b`), including reasoning mode and effort. The cloud baseline is called **frontier cloud model**, with no vendor name. The generating software is called a **local inference runtime**. No machine-specific paths appear in this tree.

## Headline findings

- A schema-constrained response removes almost all syntax errors at 4B and above when reasoning is off. It does not reliably enforce numeric min/max at generation time (`qwen3.5:2b` wrote a literal `decay: 0.7` below the minimum `0.8`). Expression strings bypass min/max completely. A **semantic validator** is required.
- **Reasoning off** is the local default. Reasoning on did not reliably raise the score, cost time, caused two 300 s timeouts, caused a qwen3.5:0.8b run to truncate mid-JSON, and left two qwen3-vl:8b runs with an empty body. On qwen3.5:9b, reasoning on also dropped the tunnel mesh and used a cube instead.
- **Practical local authors** from these runs: a **qwen3.5:9b with reasoning off** (best prompt fit — an actual tunnel mesh — with one range overflow) and a **gpt-oss:20b at medium reasoning** (clean, original, slower). A **qwen3.5:4b with reasoning off** is the fastest original, in-range document but missed the tunnel mesh. The frontier cloud model remains the quality ceiling (score 5 on both prompts).
- Several smaller models, and llama3.1:latest, passed the schema by reusing few-shot expressions or layers. Those documents scored 2.
- Modulation must target a layer by **name or id**, not by array index.

Details: [round 1](round-1.md), [round 2](round-2.md), [decisions](decisions.md), [bench](bench/README.md).
