#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

cd "$(dirname "$0")"
A="--presets=out/mvc-list.json --frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --skip-md --skip-ours"
for N in mvq-new-smooth mvq-new-milkdrop mvq-new-thin mvq-base-smooth mvq-base-milkdrop mvq-A-smooth; do
  for d in out/mvc-mdfix/p*; do id=$(basename $d); mkdir -p out/$N/$id; cp $d/f*.bgra out/$N/$id/ 2>/dev/null; done
  node run.js $A --name=$N > out/$N-score.log 2>&1
done
echo puanlandi
