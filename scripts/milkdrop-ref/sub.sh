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
C="--presets=out/sub-list.json --frames=60 --cap=2,10,20,30,40,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js $C --repo=$REPO --name=sub-main > out/sub-main.log 2>&1
cp_md sub-main sub-blur
node run.js $C --skip-md --repo=${REPO_B:-$REPO} --name=sub-blur > out/sub-blur.log 2>&1
cp_md sub-main sub-r2
node run.js $C --skip-md --name=sub-r2 > out/sub-r2.log 2>&1
I="--presets=${I750SET:?set I750SET to a local folder} --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --audio=tone --sheet=0 --line=smooth --skip-md"
cp_md i7-fix i7-blur
node run.js $I --repo=${REPO_B:-$REPO} --name=i7-blur > out/i7-blur.log 2>&1
echo SUB-BITTI
