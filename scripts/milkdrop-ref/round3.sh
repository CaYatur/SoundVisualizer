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
M=$REPO
W="--presets=out/wr150-list.json --frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js $W --repo=$M --name=wr-main > out/wr-main.log 2>&1
cp_md wr-main wr-r3
node run.js $W --skip-md --name=wr-r3 > out/wr-r3.log 2>&1
cp_md mvc-mdfix mvq-r3-smooth
node run.js --presets=out/mvc-list.json --frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --skip-md --line=smooth --name=mvq-r3-smooth > out/mvq-r3-smooth.log 2>&1
cp_md rnd-md rnd-r3-smooth
node run.js --presets=$PRESETS --sample=150 --seed=23 --frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --skip-md --line=smooth --name=rnd-r3-smooth > out/rnd-r3-smooth.log 2>&1
cp_md i7-fix i7-r3-smooth
node run.js --presets=${I750SET:?set I750SET to a local folder} --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --audio=tone --skip-md --line=smooth --name=i7-r3-smooth --sheet=0 > out/i7-r3-smooth.log 2>&1
cp_md mvs-fix mvs-main3
node run.js --presets=synth-mv --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --sheet=0 --skip-md --line=smooth --repo=$M --name=mvs-main3 > out/mvs-main3.log 2>&1
cp_md mvs-fix mvs-r3
node run.js --presets=synth-mv --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --sheet=0 --skip-md --line=smooth --name=mvs-r3 > out/mvs-r3.log 2>&1
echo R3-BITTI
