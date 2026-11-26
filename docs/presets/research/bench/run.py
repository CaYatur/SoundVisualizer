#!/usr/bin/env python3
"""Ask a local chat endpoint for a v2 preset and save the document.

This runner is deliberately vendor-neutral. You supply an HTTP URL and a
request adapter. Nothing in this file names a product, a model family, or a
machine-local path.

    python run.py --url http://127.0.0.1:PORT/path --model MODEL_ID --prompt P1

Environment (optional):
  SVP_BENCH_URL      default for --url
  SVP_BENCH_MODEL    default for --model
  SVP_BENCH_TOKEN    sent as "Authorization: Bearer ..." when set

Adapters
  chat_completions   POST a messages list and an optional JSON-Schema response
                     format (the common "chat completions" request shape).
  raw                POST the body in request-template.json, after substituting
                     {{model}}, {{system}}, {{user}}, and {{schema_json}}.

The saved file is JSON text only. Wall-clock seconds are appended to times.txt
in the output directory. This script does not score quality; use validate.py.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def load_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def system_prompt(ex1: str, ex2: str) -> str:
    return (
        "You write SoundVisualizer presets (svpreset v2) as a single JSON object "
        "that must match the given schema. Layers are applied bottom to top. "
        "Numeric parameters may be a number or a short expression string using "
        "bass, mid, treble, beat, kick, energy, time and sin, cos, abs, min, max, "
        "smooth (for example '1.01 + 0.03*bass'). Always bind the visuals to audio. "
        "Examples:\n"
        f"{ex1}\n{ex2}"
    )


def build_body(adapter: str, model: str, schema: dict, system: str, user: str, template: Path | None) -> dict:
    if adapter == "raw":
        if template is None or not template.is_file():
            raise SystemExit("raw adapter needs --template (a JSON file with placeholders)")
        text = template.read_text(encoding="utf-8")
        text = (
            text.replace("{{model}}", json.dumps(model)[1:-1])
            .replace("{{system}}", json.dumps(system)[1:-1])
            .replace("{{user}}", json.dumps(user)[1:-1])
            .replace("{{schema_json}}", json.dumps(schema))
        )
        return json.loads(text)
    # chat_completions
    return {
        "model": model,
        "temperature": 0.3,
        "max_tokens": 2500,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": "svpreset_v2", "schema": schema, "strict": True},
        },
    }


def extract_content(data: dict) -> str:
    # chat-completions shape
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = [p.get("text", "") for p in content if isinstance(p, dict)]
            return "".join(parts)
    # generic "message.content" shape
    message = data.get("message")
    if isinstance(message, dict) and isinstance(message.get("content"), str):
        return message["content"]
    if isinstance(data.get("content"), str):
        return data["content"]
    raise SystemExit("Could not find a text document in the HTTP response.")


def post(url: str, body: dict, token: str | None, timeout: int) -> dict:
    raw = json.dumps(body).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=raw, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise SystemExit(f"HTTP {exc.code}: {detail}") from exc


def main() -> int:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Run one authoring prompt against a local chat endpoint.")
    parser.add_argument("--url", default=os.environ.get("SVP_BENCH_URL"), help="HTTP endpoint (or SVP_BENCH_URL)")
    parser.add_argument("--model", default=os.environ.get("SVP_BENCH_MODEL"), help="model id (or SVP_BENCH_MODEL)")
    parser.add_argument("--prompt", default="P1", help="key in prompts.json (default P1)")
    parser.add_argument("--adapter", choices=("chat_completions", "raw"), default="chat_completions")
    parser.add_argument("--template", type=Path, help="request body template for the raw adapter")
    parser.add_argument("--out", type=Path, default=here / "out", help="output directory")
    parser.add_argument("--timeout", type=int, default=300, help="HTTP timeout in seconds")
    parser.add_argument("--schema", type=Path, default=here / "svp.schema.json")
    parser.add_argument("--prompts", type=Path, default=here / "prompts.json")
    parser.add_argument("--examples", type=Path, default=here / "examples")
    args = parser.parse_args()

    if not args.url or not args.model:
        sys.stderr.write("Both --url and --model are required (or SVP_BENCH_URL and SVP_BENCH_MODEL).\n")
        return 2

    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    prompts = json.loads(args.prompts.read_text(encoding="utf-8"))
    if args.prompt not in prompts:
        sys.stderr.write(f"Unknown prompt {args.prompt!r}. Keys: {', '.join(prompts)}\n")
        return 2
    ex1 = load_text(args.examples / "ex1.json")
    ex2 = load_text(args.examples / "ex2.json")
    system = system_prompt(ex1, ex2)
    user = "Create a preset: " + prompts[args.prompt]
    body = build_body(args.adapter, args.model, schema, system, user, args.template)

    args.out.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    try:
        response = post(args.url, body, os.environ.get("SVP_BENCH_TOKEN"), args.timeout)
        elapsed = time.perf_counter() - started
        content = extract_content(response)
        safe = "".join(ch if ch.isalnum() or ch in "-._" else "_" for ch in args.model)
        dest = args.out / f"{safe}_{args.prompt}.json"
        dest.write_text(content, encoding="utf-8")
        line = f"{args.model} {args.prompt} {elapsed:.1f}s -> {dest.name}\n"
        (args.out / "times.txt").open("a", encoding="utf-8").write(line)
        print(line, end="")
        return 0
    except SystemExit:
        elapsed = time.perf_counter() - started
        line = f"{args.model} {args.prompt} ERROR {elapsed:.1f}s\n"
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "times.txt").open("a", encoding="utf-8").write(line)
        raise


if __name__ == "__main__":
    sys.exit(main())
