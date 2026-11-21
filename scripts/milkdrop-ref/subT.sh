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
C="--presets=out/subT-list.json --frames=60 --cap=2,10,20,30,40,59 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --line=smooth"
MDREF_MVFIX=1 node run.js $C --repo=$REPO --name=subT-main > out/subT-main.log 2>&1
cp_md subT-main subT-blur
node run.js $C --skip-md --repo=${REPO_B:-$REPO} --name=subT-blur > out/subT-blur.log 2>&1
cp_md subT-main subT-r2
node run.js $C --skip-md --name=subT-r2 > out/subT-r2.log 2>&1
cp_md subT-main subT-main2
node run.js $C --skip-md --repo=$REPO --name=subT-main2 > out/subT-main2.log 2>&1
echo SUBT-BITTI
