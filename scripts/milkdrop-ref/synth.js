/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
// #580 uv yönü için yapay presetler. Her biri tek bir soruyu cevaplıyor;
// kırmızı kare (şekil, x=0.25 y=0.75) "MilkDrop'ta yukarısı neresi" işareti.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'synth');
fs.mkdirSync(OUT, { recursive: true });

function base(o) {
  const v = Object.assign({
    fDecay: 1, fGammaAdj: 1, fVideoEchoAlpha: 0, nWaveMode: 0, fWaveAlpha: 0, fWaveScale: 1,
    bAdditiveWaves: 0, bTexWrap: 1, bDarkenCenter: 0, bBrighten: 0, bDarken: 0, bSolarize: 0, bInvert: 0,
    bModWaveAlphaByVolume: 0, bMaximizeWaveColor: 0, fShader: 0, zoom: 1, rot: 0, cx: 0.5, cy: 0.5, dx: 0, dy: 0,
    warp: 0, sx: 1, sy: 1, ob_size: 0, ob_a: 0, ib_size: 0, ib_a: 0, mv_a: 0, fWarpScale: 1, fZoomExponent: 1,
  }, o.vals || {});
  let s = 'MILKDROP_PRESET_VERSION=201\nPSVERSION=2\nPSVERSION_WARP=' + (o.warp ? 2 : 0) + '\nPSVERSION_COMP=' + (o.comp ? 2 : 0) + '\n[preset00]\n';
  for (const k of Object.keys(v)) s += k + '=' + v[k] + '\n';
  if (o.shape !== false) {
    const sh = Object.assign({ enabled: 1, sides: 4, additive: 0, thickOutline: 0, textured: 0, num_inst: 1,
      x: 0.25, y: 0.75, rad: 0.06, ang: 0, tex_ang: 0, tex_zoom: 1, r: 1, g: 0, b: 0, a: 1, r2: 1, g2: 0, b2: 0, a2: 1,
      border_r: 1, border_g: 1, border_b: 1, border_a: 0 }, o.shape || {});
    for (const k of Object.keys(sh)) s += 'shapecode_0_' + k + '=' + sh[k] + '\n';
  }
  if (o.extra) s += o.extra;
  (o.pf || []).forEach((l, i) => { s += 'per_frame_' + (i + 1) + '=' + l + '\n'; });
  (o.pp || []).forEach((l, i) => { s += 'per_pixel_' + (i + 1) + '=' + l + '\n'; });
  const body = (name, lines) => {
    const all = ['shader_body', '{'].concat(lines, ['}']);
    return all.map((l, i) => name + '_' + (i + 1) + '=`' + l).join('\n') + '\n';
  };
  if (o.warp) s += body('warp', o.warp);
  if (o.comp) s += body('comp', o.comp);
  return s;
}

const SETS = {
  // Warp çıktısı doğrudan uv: kırmızı = x, yeşil = y. Birleştirme olduğu gibi gösteriyor.
  'u1-warp-uv': { warp: ['ret = float3(uv.x, uv.y, 0);'], comp: ['ret = tex2D(sampler_main, uv).xyz;'] },
  // Birleştirme uv'si
  'u2-comp-uv': { comp: ['ret = float3(uv.x, uv.y, 0);'] },
  // Birleştirmede ang ve rad
  'u3-comp-ang': { comp: ['ret = float3(frac(ang / 6.2831853), rad, 0);'] },
  // Warp örneklemesinde +uv.y: iz hangi yöne akıyor
  'u4-warp-fetch-y': { warp: ['ret = tex2D(sampler_main, uv + float2(0, 0.01)).xyz * 0.97;'], comp: ['ret = tex2D(sampler_main, uv).xyz;'], shape: { x: 0.5, y: 0.5 } },
  // Birleştirmede +uv.y örnekleme kayması
  'u5-comp-fetch-y': { comp: ['ret = tex2D(sampler_main, uv + float2(0, 0.2)).xyz;'], vals: { fDecay: 0.9 } },
  // Kare başı dy > 0: iz hangi yöne
  'u6-pf-dy': { vals: { dy: 0.01, fDecay: 0.97 }, shape: { x: 0.5, y: 0.5 } },
  // Piksel başı: y'ye bağlı dx (üstte sağa mı altta sağa mı)
  'u7-pp-y': { vals: { fDecay: 0.97 }, pp: ['dx = (y - 0.5) * 0.02;'], shape: { x: 0.5, y: 0.5, rad: 0.2 } },
  // Birleştirme sabit yol (fShader=0, gamma 1) + şekil: yalnız işaret
  'u8-plain': { vals: { fDecay: 0.9 } },
  // Warp uv ile birlikte uv_orig
  'u9-warp-uvorig': { warp: ['ret = float3(uv_orig.x, uv_orig.y, 0.5);'], comp: ['ret = tex2D(sampler_main, uv).xyz;'] },
  // Kimlik warp shader'ı + sabit birleştirme: warp geçişi görüntüyü çeviriyor mu
  'u10-warp-identity': { warp: ['ret = tex2D(sampler_main, uv).xyz * 0.9;'] },
  // uv warp + SABİT birleştirme
  'u11-warp-uv-fixedcomp': { warp: ['ret = float3(uv.x, uv.y, 0);'] },
  // Sabit warp + kimlik birleştirme shader'ı
  'u12-comp-identity': { comp: ['ret = tex2D(sampler_main, uv).xyz;'], vals: { fDecay: 0.9 } },
  // Kimlik warp + kimlik birleştirme
  'u13-both-identity': { warp: ['ret = tex2D(sampler_main, uv).xyz * 0.9;'], comp: ['ret = tex2D(sampler_main, uv).xyz;'] },
  // Yerleşik dalga: yatay çizgi kipi, wave_y=0.8 (belgede 0 = alt)
  'u14-wave-y': { vals: { fDecay: 0.9, nWaveMode: 6, fWaveAlpha: 1, fWaveScale: 1, wave_y: 0.8, wave_x: 0.5, wave_r: 1, wave_g: 1, wave_b: 1 }, shape: false },
  // Dönüş: işaret kare (0.75, 0.75), rot > 0 — iz hangi yöne dönüyor
  'm1-rot': { vals: { fDecay: 0.96, rot: 0.06 }, shape: { x: 0.75, y: 0.75, rad: 0.05 } },
  // Yakınlaşma merkezi üstte (belge: cy 0 = üst)
  'm2-cy-zoom': { vals: { fDecay: 0.96, zoom: 1.04, cy: 0.2, cx: 0.3 }, shape: { x: 0.6, y: 0.4, rad: 0.05 } },
  // sx / sy
  'm3-sx-sy': { vals: { fDecay: 0.96, sx: 1.03, sy: 0.97, cx: 0.4, cy: 0.3 }, shape: { x: 0.7, y: 0.7, rad: 0.05 } },
  // Yerleşik warp animasyonu
  'm4-warp': { vals: { fDecay: 0.98, warp: 1.5, fWarpAnimSpeed: 1, fWarpScale: 1 }, shape: { x: 0.3, y: 0.7, rad: 0.08 } },
  // per_pixel rot y'ye bağlı + cx
  'm5-pp-rot': { vals: { fDecay: 0.96, cx: 0.3 }, pp: ['rot = 0.05 * (1 - y);'], shape: { x: 0.7, y: 0.3, rad: 0.05 } },
  // Dalga kipi 7 (çift çizgi) wave_y
  'm6-wave7': { vals: { fDecay: 0.9, nWaveMode: 7, fWaveAlpha: 1, fWaveScale: 1, wave_y: 0.7, wave_r: 1, wave_g: 0.5, wave_b: 0 }, shape: false },
  // Hareket vektörleri: dy ve dönüşle yön
  'm7-mv': { vals: { fDecay: 0.5, dy: 0.01, rot: 0.02, nMotionVectorsX: 8, nMotionVectorsY: 6, mv_a: 1, mv_l: 5, mv_r: 1, mv_g: 1, mv_b: 0 }, shape: false },
  // Dokulu şekil: önceki kareden bir pencere (uv degradesinin üstünde)
  'm8-textured': { warp: ['ret = float3(uv.x, uv.y, 0.3);'], shape: { x: 0.35, y: 0.65, rad: 0.3, textured: 1, tex_zoom: 0.7, tex_ang: 0.4, r: 1, g: 1, b: 1, a: 1, r2: 1, g2: 1, b2: 1, a2: 1, ang: 0.3 } },
  // Sabit birleştirmede yankı: yön 1, 2, 3
  'm9-echo2': { vals: { fDecay: 0.9, fVideoEchoAlpha: 0.5, fVideoEchoZoom: 1.3, nVideoEchoOrientation: 2 }, shape: { x: 0.3, y: 0.8, rad: 0.08 } },
  'm10-echo3': { vals: { fDecay: 0.9, fVideoEchoAlpha: 0.5, fVideoEchoZoom: 1.3, nVideoEchoOrientation: 3 }, shape: { x: 0.3, y: 0.8, rad: 0.08 } },
  // Kenarlıklar: dış kalın, iç ince, renkli
  'm11-borders': { vals: { fDecay: 0.9, ob_size: 0.05, ob_r: 1, ob_g: 0, ob_b: 0, ob_a: 1, ib_size: 0.02, ib_r: 0, ib_g: 1, ib_b: 0, ib_a: 1 }, shape: { x: 0.3, y: 0.8, rad: 0.05 } },
  // Dört köşe rengi: birleştirme shader'ında hue_shader, sabit yolda fShader
  'h1-hue-shader': { comp: ['ret = hue_shader;'], shape: false },
  'h2-hue-fixed': { warp: ['ret = float3(1, 1, 1);'], vals: { fShader: 1, fGammaAdj: 1 }, shape: false },
  // Özel dalga: y = 0.8 yatay çizgi, x soldan sağa
  'u15-custom-wave': { vals: { fDecay: 0.9 }, shape: false, extra: 'wavecode_0_enabled=1\nwavecode_0_samples=64\nwavecode_0_r=0\nwavecode_0_g=1\nwavecode_0_b=1\nwavecode_0_a=1\nwavecode_0_bUseDots=0\nwavecode_0_bDrawThick=1\nwavecode_0_bAdditive=0\nwavecode_0_scaling=1\nwavecode_0_smoothing=0\nwave_0_per_point1=x = 0.1 + sample * 0.3;\nwave_0_per_point2=y = 0.8 - sample * 0.2;\n' },
};
for (const [n, o] of Object.entries(SETS)) fs.writeFileSync(path.join(OUT, n + '.milk'), base(o));
console.log(Object.keys(SETS).length + ' preset ->', OUT);
