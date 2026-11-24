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
H=${REPO_B:-$REPO}
A="--frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js --presets=out/wr150-list.json $A --name=h-wr-r3 > out/h-wr-r3.log 2>&1
cp_md h-wr-r3 h-wr-hq; node run.js --presets=out/wr150-list.json $A --skip-md --repo=$H --name=h-wr-hq > out/h-wr-hq.log 2>&1
MDREF_MVFIX=1 node run.js --presets=$PRESETS --sample=150 --seed=23 $A --name=h-rnd-r3 > out/h-rnd-r3.log 2>&1
cp_md h-rnd-r3 h-rnd-hq; node run.js --presets=$PRESETS --sample=150 --seed=23 $A --skip-md --repo=$H --name=h-rnd-hq > out/h-rnd-hq.log 2>&1
MDREF_MVFIX=1 node run.js --presets=out/mvc-list.json $A --name=h-mvq-r3 > out/h-mvq-r3.log 2>&1
cp_md h-mvq-r3 h-mvq-hq; node run.js --presets=out/mvc-list.json $A --skip-md --repo=$H --name=h-mvq-hq > out/h-mvq-hq.log 2>&1
I="--presets=${I750SET:?set I750SET to a local folder} --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --audio=tone --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js $I --name=h-i7-r3 > out/h-i7-r3.log 2>&1
cp_md h-i7-r3 h-i7-hq; node run.js $I --skip-md --repo=$H --name=h-i7-hq > out/h-i7-hq.log 2>&1
S="--presets=synth-mv --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js $S --name=h-mvs-r3 > out/h-mvs-r3.log 2>&1
cp_md h-mvs-r3 h-mvs-hq; node run.js $S --skip-md --repo=$H --name=h-mvs-hq > out/h-mvs-hq.log 2>&1
echo HQ-BITTI
