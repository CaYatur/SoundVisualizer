# Round 1

Date of the recorded run: 26 November 2026 (Europe/Istanbul). Single pass, one operator machine. Hardware was not written down in the run log.

Setup: draft v2 schema (12 blocks), two few-shot examples, schema-constrained response when the server allowed it, temperature 0.3, completion cap 2500 tokens. Prompts P1 (neon tunnel, feedback, kick) and P2 (3D crystal, bloom, treble, orbit). Most local models were asked for P1 only.

Quality is the structural 1–5 rubric in [README.md](README.md). Not a rendered-frame score. Latency is wall-clock. The frontier cloud model's latency was not recorded.

## Results

| Model | Prompt | Schema | Quality | Latency | Notes |
|---|---|---|---:|---:|---|
| Frontier cloud model | P1 | pass | 5 | — | Eight-layer stack. Expressions in range. Destinations valid. Original. |
| Frontier cloud model | P2 | pass | 5 | — | Crystal, orbit camera, particles, treble-bound scale and bloom. Clean. |
| gpt-oss:20b | P1 | pass | 3 | 62.1 s | Valid and in range. Adds a text layer; no tunnel mesh. |
| qwen3.5:9b | P1 | pass | 3 | 100.1 s | Feedback plus a tunnel mesh — the richest local stack — but particle speed `"2 + 4*treble"` can reach 6 on a 0–5 field, and a route writes `zoom` onto a waveform. The long wall time may include a cold load; P2 on the same model was 18.1 s. |
| qwen3.5:9b | P2 | pass | 3 | 18.1 s | Orbit camera and treble bindings. Mesh is an icosahedron, not a crystal. Displace and bloom intensity can leave their ranges. |
| qwen2.5-coder:7b | P1 | pass | 2 | 30.8 s | Has a tunnel mesh, but a flat black gradient and a close echo of the few-shot bloom and zoom expression. |
| qwen3.5:4b | P1 | pass | 3 | 21.1 s | Schema-valid neon stack. Mesh is a torus, not a tunnel. A route sets feedback zoom max to 1.5. |
| phi4-mini:latest | P1 | pass | 3 | 21.1 s | Eight-layer kitchen-sink stack. A route writes `thickness` onto a feedback block. |
| gemma4:e2b-it-q4_K_M | P1 | pass | 3 | 32.4 s | Schema-valid, but thickness `"5 + 10*bass"` can reach 15, two routes exceed the field max, and one route writes `intensity` onto a vignette (the field is `strength`). |

Every saved document in this round parsed and passed JSON Schema. That is the ceiling of what a schema-constrained response can claim. P2 was only run twice.

The original run files are not copied into this tree (raw run artifacts are not copied here). The bench is in [`bench/`](bench/README.md).
