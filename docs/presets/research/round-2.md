# Round 2

Date of the recorded run: 26 November 2026 (Europe/Istanbul). Single pass, same schema, examples and prompts as [round 1](round-1.md), with reasoning mode varied. Most calls were P1 only. A 300 s timeout was applied. Hardware was not written down in the run log.

Quality is the structural 1–5 rubric in [README.md](README.md). Latency is wall-clock.

## Results

| Model | Reasoning | Prompt | Schema | Quality | Latency | Notes |
|---|---|---|---|---:|---:|---|
| gpt-oss:20b | low | P1 | pass | 3 | 39 s | Tunnel stack, but a `sin(...)` displacement can go negative on a 0–1 field. |
| gpt-oss:20b | medium | P1 | pass | 4 | 96 s | Clean, original, no range or destination issues found. |
| gpt-oss:20b | high | P1 | timeout | — | 300.2 s | No document. |
| qwen3.5:9b | off | P1 | pass | 4 | 36.5 s | Actual tunnel mesh, dense bindings. One particle-speed overflow (`"2 + 6*kick"` can reach 8 on a 0–5 field). Best prompt fit among local models in this set. |
| qwen3.5:9b | on | P1 | pass | 3 | 27.5 s | Mesh is a cube, not a tunnel. A route sets feedback zoom to 0.8–1.5 (legal range 0.9–1.1). Reasoning on did not improve prompt fit. |
| qwen3.5:4b | off | P1 | pass | 3 | 12.6 s | Schema-valid, in range, original, and fast — but no tunnel mesh. |
| qwen3.5:4b | on | P1 | pass | 3 | 47.4 s | Two routes exceed the destination max. Slower, and no better than off. |
| qwen3.8:latest | off | P1 | pass | 3 | 84.9 s | Load time similar to gpt-oss:20b (~22 s). A text layer; no tunnel mesh; two modest destination-max slips. |
| qwen3.8:latest | off | P2 | pass | 4 | 93.3 s | Crystal, orbit, particles, treble binding. Clean. |
| qwen3.8:latest | on | P1 | timeout | — | 300.1 s | No document. |
| llama3.1:latest | off | P1 | pass | 2 | 9.7 s | Schema-valid and in range, but reuses several few-shot expressions. |
| qwen3-vl:8b | none | P1 | empty | 1 | 83.4 s | Completion cap spent on reasoning text; empty body. |
| qwen3-vl:8b | off | P1 | empty | 1 | 84 s | Same pattern. Asking for "off" was not enough to stop reasoning text on this server. |
| qwen3.5:2b | off | P1 | fail | 2 | 7.6 s | Literal `decay: 0.7` (minimum `0.8`). JSON Schema rejected it after the fact. Zoom `"1.2 + 0.8*kick"` evaluates to 1.2–2.0 on a 0.9–1.1 field. |
| llama3.2:1b | off | P1 | pass | 2 | 5.1 s | Few-shot copy, plus routes that write `blur` and `warp` onto a gradient. |
| qwen3.5:0.8b | none (reasoning leaked) | P1 | invalid JSON | 1 | 20 s | Truncated mid-object after hitting the completion cap. |
| qwen3.5:0.8b | off | P1 | pass | 2 | 4.8 s | Schema-valid by reusing few-shot expressions. |
| smallthinker:latest | off | P1 | pass | 2 | 7.7 s | Schema-valid, but close to the few-shot examples (shared colours and expressions). |

## Findings

1. **Reasoning is not the default.** On qwen3.5:9b it replaced a tunnel mesh with a cube. On qwen3.5:4b it made the document worse and slower. At high or on, gpt-oss:20b and qwen3.8:latest both hit the 300 s cap.
2. **Constrained generation does not enforce numeric min/max.** The qwen3.5:2b `decay: 0.7` case is the literal-number proof. Expression strings never even enter that check.
3. **A semantic validator is not optional.** The repeated defects are out-of-range expression results, destination fields that do not exist on the target block, and destination min/max outside the field range.
4. **Practical local authors.** A qwen3.5:9b with reasoning off (best prompt fit, one range overflow) and a gpt-oss:20b at medium reasoning (clean, original, slower). A qwen3.5:4b with reasoning off is the fastest original, in-range document but missed the tunnel mesh. The frontier cloud model from round 1 remains the quality ceiling.
5. **Example copying** is the dominant failure mode at and below ~2B, and also for llama3.1:latest. A schema-valid near-copy scored 2 in this set.
6. **Vision-language builds were the wrong tool** for this brief in this run: both calls returned an empty body.

See [`bench/`](bench/README.md). Raw output files from the operator machine are not copied here.
