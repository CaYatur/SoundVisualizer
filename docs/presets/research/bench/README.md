# Authoring bench

Repeatable materials for the AI authoring benchmark. Nothing in this folder names a vendor, a model family, or a machine-local path.

The recorded rounds used a P1 wording that mentioned a legacy-engine idiom. The copy stored here is the **sanitized** prompt, which is what later repeats of the bench should use. The original wording is not kept in this tree.

| File | Role |
|---|---|
| `svp.schema.json` | Draft v2 JSON Schema used in the recorded rounds (12 blocks). The `$id` is documentary; the body matches the research schema. |
| `prompts.json` | **P1** deep-bass neon tunnel with feedback and kick pulses. **P2** rotating 3D crystal with bloom, treble reaction, and a slow camera orbit. |
| `examples/ex1.json`, `examples/ex2.json` | Few-shot examples included in the system instruction. |
| `validate.py` | JSON parse, JSON Schema, and semantic checks (expression ranges, modulation destinations). |
| `run.py` | Generic HTTP runner. You pass `--url` and `--model`. |

## Validate a document

```bash
python -m pip install jsonschema
python validate.py path/to/preset.json
python validate.py path/to/a/folder --strict
```

`--strict` treats an expression that *can* leave its field range as an error. The default is to print those as warnings, which matches the proposed "clamp at runtime, warn at load" rule.

## Run a prompt

```bash
python run.py --url http://127.0.0.1:PORT/v1/chat/completions --model MODEL_ID --prompt P1 --out ./out
python validate.py ./out
```

`--adapter chat_completions` (the default) posts a messages list and a JSON-Schema response format. If your server uses a different body, write a JSON template and pass `--adapter raw --template request-template.json`. The placeholders are `{{model}}`, `{{system}}`, `{{user}}`, and `{{schema_json}}`.

`SVP_BENCH_URL`, `SVP_BENCH_MODEL`, and `SVP_BENCH_TOKEN` can replace the corresponding flags. The runner does not score quality; that is the 1–5 rubric in the parent [README](../README.md).

## What this bench does not include

Raw output files from the recorded rounds are not stored here. The tables live in [round-1.md](../round-1.md) and [round-2.md](../round-2.md).
