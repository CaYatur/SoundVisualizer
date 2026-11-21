#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
# A/B: aynı MilkDrop 2 kareleri, iki motor sürümü (taban = ../sv-base, dal = ana çalışma kopyası)
# kullanım: sh ab.sh <ad> <örnek> <tohum> [kareler] [yakalama]
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

N=$1; S=$2; SEED=$3; F=${4:-60}; CAP=${5:-2,10,30,59}
cd "$(dirname "$0")"
node run.js --presets=$PRESETS --sample=$S --seed=$SEED --name=$N-base \
  --frames=$F --cap=$CAP --audio=tone --warm=${WARM:-0} --repo=${REPO_BASE:-$REPO} --sheet=0 > out/$N-base.log 2>&1
mkdir -p out/$N-fix
for d in out/$N-base/p*; do id=$(basename $d); mkdir -p out/$N-fix/$id; cp $d/f*.bgra out/$N-fix/$id/ 2>/dev/null; done
node run.js --presets=$PRESETS --sample=$S --seed=$SEED --name=$N-fix \
  --frames=$F --cap=$CAP --audio=tone --warm=${WARM:-0} --skip-md --sheet=3 > out/$N-fix.log 2>&1
echo bitti
