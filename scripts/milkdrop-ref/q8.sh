#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

cd "$(dirname "$0")"
C="--presets=out/q8-list.json --frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js $C --name=q8-r3 > out/q8-r3.log 2>&1
rm -rf out/q8-8b; mkdir -p out/q8-8b; for d in out/q8-r3/p*; do id=$(basename $d); mkdir -p out/q8-8b/$id; cp $d/f*.bgra out/q8-8b/$id/; done
node run.js $C --skip-md --repo=${REPO_B:-$REPO} --name=q8-8b > out/q8-8b.log 2>&1
echo Q8-BITTI
