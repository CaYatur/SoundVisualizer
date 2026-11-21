#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

cd "$(dirname "$0")"
cp_md(){ rm -rf out/$2; mkdir -p out/$2; for d in out/$1/p*; do id=$(basename $d); mkdir -p out/$2/$id; cp $d/f*.bgra out/$2/$id/ 2>/dev/null; done; [ -f out/$1/list.json ] && cp out/$1/list.json out/$2/; }
cp_md mvc-mdfix mvq-r2-smooth
node run.js --presets=out/mvc-list.json --frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --skip-md --line=smooth --name=mvq-r2-smooth > out/mvq-r2-smooth.log 2>&1
cp_md rnd-md rnd-r2-smooth
node run.js --presets=$PRESETS --sample=150 --seed=23 --frames=60 --cap=2,10,30,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --skip-md --line=smooth --name=rnd-r2-smooth > out/rnd-r2-smooth.log 2>&1
cp_md i7-fix i7-r2-smooth
node run.js --presets=${I750SET:?set I750SET to a local folder} --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --audio=tone --skip-md --line=smooth --name=i7-r2-smooth --sheet=0 > out/i7-r2-smooth.log 2>&1
cp_md mvs-stock mvs-r2
node run.js --presets=synth-mv --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --sheet=0 --skip-md --line=smooth --name=mvs-r2 > out/mvs-r2.log 2>&1
echo R2-BITTI
