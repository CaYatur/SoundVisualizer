#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
# #752 korpus MV alt kümesi: MD bir kez, bizim taban (sv-base) ve dal; çizgi biçimi $1
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

L=${1:-smooth}
cd "$(dirname "$0")"
A="--presets=out/mvc-list.json --frames=60 --cap=59 --warm=90 --w=960 --h=720 --audio=tone"
if [ ! -f out/mvc-md/done ]; then node run.js $A --name=mvc-md --skip-ours --sheet=0 > out/mvc-md.log 2>&1; touch out/mvc-md/done; fi
for V in base fix; do
  N=mvc-$V-$L; mkdir -p out/$N
  for d in out/mvc-md/p*; do id=$(basename $d); mkdir -p out/$N/$id; cp $d/f*.bgra out/$N/$id/ 2>/dev/null; done
  R=$REPO; [ $V = base ] && R=${REPO_BASE:-$REPO}
  node run.js $A --name=$N --skip-md --line=$L --repo=$R --sheet=3 > out/$N.log 2>&1
done
echo bitti $L
