#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

cd "$(dirname "$0")"
A="--presets=${I750SET:?set I750SET to a local folder} --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --audio=tone"
node run.js $A --name=i7-stock --skip-ours --sheet=0 > out/i7-stock.log 2>&1
MDREF_MVFIX=1 node run.js $A --name=i7-fix --skip-ours --sheet=0 > out/i7-fix.log 2>&1
for V in new base; do for L in smooth milkdrop; do
  N=i7-$V-$L; rm -rf out/$N; mkdir -p out/$N
  for d in out/i7-fix/p*; do id=$(basename $d); mkdir -p out/$N/$id; cp $d/f*.bgra out/$N/$id/; done
  R=$REPO; [ $V = base ] && R=${REPO_BASE:-$REPO}
  node run.js $A --name=$N --skip-md --line=$L --repo=$R --sheet=0 > out/$N.log 2>&1
done; done
echo bitti
