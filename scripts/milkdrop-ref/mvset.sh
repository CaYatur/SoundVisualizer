#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
# #752 MV seti: MD stock + MD fix + bizim (milkdrop / smooth). kullanım: sh mvset.sh <önek> [repo]
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

P=$1; R=${2:-$REPO}
cd "$(dirname "$0")"
A="--presets=synth-mv --frames=60 --cap=59 --warm=90 --w=1440 --h=896 --sheet=0"
if [ ! -d out/mvs-stock ]; then node run.js $A --name=mvs-stock --skip-ours > out/mvs-stock.log 2>&1; MDREF_MVFIX=1 node run.js $A --name=mvs-fix --skip-ours > out/mvs-fix.log 2>&1; fi
for L in milkdrop smooth; do
  mkdir -p out/$P-$L; cp out/mvs-stock/list.json out/$P-$L/
  for d in out/mvs-stock/p*; do id=$(basename $d); mkdir -p out/$P-$L/$id; cp $d/f*.bgra out/$P-$L/$id/; done
  node run.js $A --name=$P-$L --skip-md --line=$L --repo=$R > out/$P-$L.log 2>&1
done
cp out/mvs-stock/list.json out/mvs-fix/
echo "== $P milkdrop"; node mvcmp.js --a=out/mvs-stock --b=out/mvs-fix --o=out/$P-milkdrop --o2=out/$P-smooth --w=1440 --h=896 --png=out/mvcmp-$P
