#!/bin/sh
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO=${REPO:-$(CDPATH= cd -- "$ROOT/../.." && pwd)}
PRESETS=${PRESETS:-"$ROOT/synth"}

cd "$(dirname "$0")"
MDREF_MVFIX=1 node run.js --presets=synth-trmv --frames=31 --cap=2,10,20,30 --warm=90 --w=960 --h=720 --audio=tone --sheet=0 --line=smooth --name=trmv > out/trmv.log 2>&1
echo TRMV-BITTI
