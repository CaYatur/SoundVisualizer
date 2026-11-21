/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
// #752 kalite turu: her çizim katmanı tek başına, decay=0 (yalnız o karenin çizimi)
const fs = require('fs'), path = require('path');
const base = fs.readFileSync(path.join(__dirname, '..', 'synth', 'm7-mv.milk'), 'utf-8').replace(/\r\n/g, '\n').trim().split('\n');
function make(name, over, extra) {
  over = Object.assign({ fDecay: 0, mv_a: 0, rot: 0, dy: 0 }, over);
  const lines = base.map((l) => { const k = l.split('=')[0]; if (k in over) { const v = over[k]; delete over[k]; return k + '=' + v; } return l; });
  for (const k of Object.keys(over)) lines.push(k + '=' + over[k]);
  fs.writeFileSync(path.join(__dirname, name + '.milk'), lines.concat(extra || []).join('\r\n') + '\r\n');
}
const W = { fWaveAlpha: 1, fWaveScale: 1, wave_r: 1, wave_g: 1, wave_b: 1, bAdditiveWaves: 0, bMaximizeWaveColor: 1, bModWaveAlphaByVolume: 0 };
for (let m = 0; m <= 7; m++) make('w' + m, Object.assign({ nWaveMode: m, bWaveThick: 0, bWaveDots: 0 }, W));
for (const m of [0, 2, 6]) make('w' + m + '-thick', Object.assign({ nWaveMode: m, bWaveThick: 1, bWaveDots: 0 }, W));
for (const m of [0, 6]) make('w' + m + '-dots', Object.assign({ nWaveMode: m, bWaveThick: 0, bWaveDots: 1 }, W));
const shape = (thick, textured, a) => [
  'shapecode_0_enabled=1', 'shapecode_0_sides=5', 'shapecode_0_additive=0', 'shapecode_0_thickOutline=' + thick,
  'shapecode_0_textured=' + textured, 'shapecode_0_num_inst=1', 'shapecode_0_x=0.4', 'shapecode_0_y=0.6', 'shapecode_0_rad=0.25',
  'shapecode_0_ang=0.3', 'shapecode_0_r=1', 'shapecode_0_g=0.5', 'shapecode_0_b=0', 'shapecode_0_a=' + a,
  'shapecode_0_r2=0', 'shapecode_0_g2=0.5', 'shapecode_0_b2=1', 'shapecode_0_a2=' + a,
  'shapecode_0_border_r=1', 'shapecode_0_border_g=1', 'shapecode_0_border_b=1', 'shapecode_0_border_a=1'];
make('s-thin', {}, shape(0, 0, 0));
make('s-thick', {}, shape(1, 0, 0));
make('s-fill', {}, shape(0, 0, 1));
const cw = (thick, dots, add) => [
  'wavecode_0_enabled=1', 'wavecode_0_samples=200', 'wavecode_0_r=0', 'wavecode_0_g=1', 'wavecode_0_b=1', 'wavecode_0_a=1',
  'wavecode_0_bUseDots=' + dots, 'wavecode_0_bDrawThick=' + thick, 'wavecode_0_bAdditive=' + add, 'wavecode_0_scaling=1', 'wavecode_0_smoothing=0',
  'wave_0_per_point1=x = 0.1 + sample * 0.8;', 'wave_0_per_point2=y = 0.5 + 0.3 * sin(sample * 12.566);'];
make('c-thin', {}, cw(0, 0, 0));
make('c-thick', {}, cw(1, 0, 0));
make('c-dots', {}, cw(0, 1, 0));
make('c-thickdots', {}, cw(1, 1, 0));
make('b-borders', { ob_size: 0.05, ob_a: 1, ob_r: 1, ob_g: 0, ob_b: 0, ib_size: 0.02, ib_a: 1, ib_r: 0, ib_g: 1, ib_b: 0 });
make('b-darken', { bDarkenCenter: 1 }, shape(0, 0, 1).map((l) => l.replace('rad=0.25', 'rad=2').replace(/_(r2?|g2?|b2?)=[0-9.]+/, (m, k) => '_' + k + '=1')));
