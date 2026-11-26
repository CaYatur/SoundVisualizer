#!/usr/bin/env python3
"""Validate svpreset v2 draft documents.

Checks, in order:
  1. JSON parse
  2. JSON Schema (draft 2020-12)
  3. Semantic rules the schema cannot express:
       - expression results stay inside the field's min/max
         (audio variables sampled at 0, 0.5, 1; time at a small set of values)
       - modulation destinations name a field that exists on the target layer
       - modulation min/max stay inside that field's range

Usage:
  python validate.py [--schema svp.schema.json] FILE [FILE ...]
  python validate.py DIR

Exit status is 0 only when every file is schema-valid and has no semantic errors.
Warnings (expressions that would be clamped under the proposed load rule) are
printed but do not fail the run unless --strict is set.

Requires the `jsonschema` package.
"""
from __future__ import annotations

import argparse
import ast
import json
import math
import sys
from pathlib import Path

try:
    import jsonschema
except ImportError:
    sys.stderr.write("This script needs the jsonschema package.\n")
    sys.exit(2)

RANGES = {
    "feedback": {"zoom": (0.9, 1.1), "rotate": (-0.2, 0.2), "decay": (0.8, 0.999), "warp": (0, 2), "blur": (0, 4)},
    "gradient": {"angle": (0, 360), "speed": (-2, 2)},
    "particles": {"size": (0.5, 20), "speed": (0, 5), "count": (10, 50000)},
    "mesh3d": {"scale": (0.1, 5), "displace": (0, 1), "rotate": (-3, 3)},
    "camera": {"distance": (0.5, 20), "fov": (20, 120), "speed": (-2, 2)},
    "text": {"size": (8, 200)},
    "bloom": {"intensity": (0, 3), "threshold": (0, 1), "radius": (0, 10)},
    "colorgrade": {"hue": (-180, 180), "saturation": (0, 2), "contrast": (0.5, 2), "exposure": (-2, 2)},
    "kaleido": {"angle": (0, 360), "segments": (2, 16)},
    "waveform": {"thickness": (0.5, 10)},
    "glitch": {"amount": (0, 1)},
    "vignette": {"strength": (0, 1)},
}

# Fields a block may have that are not ranged numbers.
ALLOWED_FIELDS = {
    "gradient": {"type", "colors", "angle", "speed", "id", "name"},
    "feedback": {"type", "zoom", "rotate", "decay", "warp", "blur", "id", "name"},
    "particles": {"type", "count", "size", "speed", "color", "emit", "id", "name"},
    "mesh3d": {"type", "shape", "scale", "rotate", "color", "material", "displace", "id", "name"},
    "camera": {"type", "mode", "distance", "fov", "speed", "id", "name"},
    "text": {"type", "content", "size", "color", "align", "id", "name"},
    "bloom": {"type", "intensity", "threshold", "radius", "id", "name"},
    "colorgrade": {"type", "hue", "saturation", "contrast", "exposure", "id", "name"},
    "kaleido": {"type", "segments", "angle", "id", "name"},
    "waveform": {"type", "style", "color", "thickness", "id", "name"},
    "glitch": {"type", "amount", "on", "id", "name"},
    "vignette": {"type", "strength", "id", "name"},
}

AUDIO_VARS = ("bass", "mid", "treble", "beat", "kick", "energy")
FUNCS = frozenset({"sin", "cos", "abs", "min", "max", "smooth"})
TIME_SAMPLES = (0.0, 1.5708, 3.1416, 10.0, 50.0)


class ExprError(ValueError):
    pass


class SafeEval(ast.NodeVisitor):
    def __init__(self, env: dict) -> None:
        self.env = env

    def visit(self, node):  # type: ignore[override]
        if isinstance(node, ast.Expression):
            return self.visit(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return float(node.value)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -self.visit(node.operand)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.UAdd):
            return self.visit(node.operand)
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            a, b = self.visit(node.left), self.visit(node.right)
            if isinstance(node.op, ast.Add):
                return a + b
            if isinstance(node.op, ast.Sub):
                return a - b
            if isinstance(node.op, ast.Mult):
                return a * b
            if b == 0:
                return 0.0
            return a / b
        if isinstance(node, ast.Name):
            if node.id in self.env:
                return self.env[node.id]
            raise ExprError("unknown name: " + node.id)
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in FUNCS:
                raise ExprError("unknown function")
            args = [self.visit(a) for a in node.args]
            name = node.func.id
            if name == "sin":
                return math.sin(args[0])
            if name == "cos":
                return math.cos(args[0])
            if name == "abs":
                return abs(args[0])
            if name == "min":
                return min(args)
            if name == "max":
                return max(args)
            if name == "smooth":
                return args[0]
        raise ExprError("unsupported expression")


def eval_expr(text: str, env: dict) -> float:
    tree = ast.parse(text, mode="eval")
    return float(SafeEval(env).visit(tree))


def looks_like_expr(value: str) -> bool:
    if not isinstance(value, str):
        return False
    if value.startswith("#"):
        return False
    return any(ch in value for ch in "+*/") or any(
        tok in value for tok in AUDIO_VARS + ("sin", "cos", "time", "abs", "min", "max", "smooth")
    )


def bounds_of(text: str) -> tuple[float, float]:
    names = [n for n in AUDIO_VARS if n in text]
    grids = [[0.0, 0.5, 1.0] for _ in names] or [[0.0]]
    times = TIME_SAMPLES if "time" in text else (0.0,)
    lo, hi = float("inf"), float("-inf")
    # Cartesian sample of the audio variables, small enough for this grammar.
    from itertools import product

    if names:
        combos = product(*grids)
    else:
        combos = [()]
    last_err = None
    for combo in combos:
        env = {n: combo[i] for i, n in enumerate(names)} if names else {}
        for t in times:
            env["time"] = t
            try:
                v = eval_expr(text, env)
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                continue
            lo, hi = min(lo, v), max(hi, v)
    if lo == float("inf"):
        raise ExprError(str(last_err) if last_err else "could not evaluate")
    return lo, hi


def collect_files(paths: list[Path]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        if p.is_dir():
            out.extend(sorted(p.glob("*.json")))
        else:
            out.append(p)
    return out


def check_file(path: Path, validator: jsonschema.Validator) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    raw = path.read_text(encoding="utf-8-sig")
    if not raw.strip():
        return [f"{path.name}: empty file"], warnings
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        return [f"{path.name}: invalid JSON ({exc})"], warnings

    schema_errors = list(validator.iter_errors(data))
    if schema_errors:
        first = schema_errors[0]
        errors.append(f"{path.name}: schema: {first.message}")

    if not isinstance(data, dict):
        return errors or [f"{path.name}: document is not an object"], warnings

    layers = data.get("layers") if isinstance(data.get("layers"), list) else []

    def check_value(label: str, typ: str, field: str, value) -> None:
        rng = RANGES.get(typ, {}).get(field)
        if rng is None:
            return
        lo, hi = rng
        if isinstance(value, (int, float)):
            if value < lo or value > hi:
                errors.append(f"{path.name}: {label} literal {value} outside {lo}..{hi}")
            return
        if isinstance(value, str) and looks_like_expr(value):
            try:
                a, b = bounds_of(value)
            except ExprError as exc:
                errors.append(f"{path.name}: {label} expression {value!r} ({exc})")
                return
            if a < lo or b > hi:
                warnings.append(
                    f"{path.name}: {label} expression {value!r} evaluates to {a:.4g}..{b:.4g}, "
                    f"outside {lo}..{hi}"
                )

    for i, layer in enumerate(layers):
        if not isinstance(layer, dict):
            continue
        typ = layer.get("type")
        for field, value in layer.items():
            if field == "rotate" and typ == "mesh3d" and isinstance(value, list):
                for j, item in enumerate(value):
                    check_value(f"layers[{i}].rotate[{j}]", typ, "rotate", item)
            else:
                check_value(f"layers[{i}].{field}", typ, field, value)

    for i, route in enumerate(data.get("mod") or []):
        if not isinstance(route, dict):
            continue
        dst = str(route.get("dst") or "")
        # Research schema form: layers.N.field — flag it, and still resolve it.
        parts = dst.split(".")
        if len(parts) != 3 or parts[0] != "layers" or not parts[1].isdigit():
            errors.append(f"{path.name}: mod[{i}] destination {dst!r} is not layers.<index>.<field>")
            continue
        idx, field = int(parts[1]), parts[2]
        if idx >= len(layers) or not isinstance(layers[idx], dict):
            errors.append(f"{path.name}: mod[{i}] destination index {idx} is out of range")
            continue
        typ = layers[idx].get("type")
        allowed = ALLOWED_FIELDS.get(typ, set())
        if field not in allowed:
            errors.append(
                f"{path.name}: mod[{i}] destination {dst} is not a field of {typ}"
            )
            continue
        rng = RANGES.get(typ, {}).get(field)
        if rng and route.get("min") is not None and route["min"] < rng[0]:
            errors.append(
                f"{path.name}: mod[{i}] min {route['min']} is below {typ}.{field} min {rng[0]}"
            )
        if rng and route.get("max") is not None and route["max"] > rng[1]:
            errors.append(
                f"{path.name}: mod[{i}] max {route['max']} is above {typ}.{field} max {rng[1]}"
            )

    return errors, warnings


def main() -> int:
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Validate svpreset v2 draft documents.")
    parser.add_argument("paths", nargs="+", type=Path, help="JSON files or directories")
    parser.add_argument("--schema", type=Path, default=here / "svp.schema.json")
    parser.add_argument("--strict", action="store_true", help="treat range warnings as errors")
    args = parser.parse_args()

    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema)

    files = collect_files(args.paths)
    if not files:
        sys.stderr.write("No JSON files to check.\n")
        return 2

    failed = 0
    for path in files:
        errors, warnings = check_file(path, validator)
        if args.strict:
            errors.extend(warnings)
            warnings = []
        for line in errors:
            print("ERROR", line)
        for line in warnings:
            print("WARN ", line)
        if not errors and not warnings:
            print("OK   ", path.name)
        if errors:
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
