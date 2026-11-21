#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

cd "$(dirname "$0")"
cp_md(){ rm -rf out/$2; mkdir -p out/$2; for d in out/$1/p*; do id=$(basename $d); mkdir -p out/$2/$id; cp $d/f*.bgra out/$2/$id/ 2>/dev/null; done; }
R=${REPO_B:-$REPO}
A="--frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js --jobs=8 --presets=out/ns100-list.json $A --repo=$R --name=h-ns-r3 > out/h-ns-r3.log 2>&1
cp_md h-ns-r3 h-ns-hq2; node run.js --jobs=8 --presets=out/ns100-list.json $A --skip-md --name=h-ns-hq2 > out/h-ns-hq2.log 2>&1
cp_md h-rnd-r3 h-rnd-hq2; node run.js --jobs=8 --presets=$PRESETS --sample=150 --seed=23 $A --skip-md --name=h-rnd-hq2 > out/h-rnd-hq2.log 2>&1
cp_md h-mvq-r3 h-mvq-hq2; node run.js --jobs=8 --presets=out/mvc-list.json $A --skip-md --name=h-mvq-hq2 > out/h-mvq-hq2.log 2>&1
I="--presets=${I750SET:?set I750SET to a local folder} --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --audio=tone --sheet=0 --line=smooth"
cp_md h-i7-r3 h-i7-hq2; node run.js --jobs=8 $I --skip-md --name=h-i7-hq2 > out/h-i7-hq2.log 2>&1
S="--presets=synth-mv --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --sheet=0 --line=smooth"
cp_md h-mvs-r3 h-mvs-hq2; node run.js --jobs=8 $S --skip-md --name=h-mvs-hq2 > out/h-mvs-hq2.log 2>&1
echo HQ2-BITTI
