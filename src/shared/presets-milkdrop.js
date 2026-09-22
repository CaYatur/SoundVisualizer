'use strict';
/* YERLEŞİK MİLKDROP PRESETLERİ — CAYADEV'in kendi yazdıkları.

   MilkDrop motoru v3.1.2'den beri var ama uygulama tek bir preset ile
   geliyordu: kullanıcı kendi .milk paketini eklemeden motorun ne yaptığı
   görünmüyordu. Buradaki beşi farklı türden birer örnek ve aynı zamanda
   okunacak birer kaynak — hepsi bu depoda yazıldı, hiçbiri bir pakete ya da
   başka bir uygulamaya ait değil.

   Kayıt biçimi presets-shaders.js ile aynı: liste `SVPresets` yerleşik
   havuzuna giriyor, yani panel, katman seçicisi ve otomatik geçiş üçü de
   ayrım yapmadan görüyor (`byKind('milkdrop')`).

   Kimlikler koddan geliyor ve SABİT: kullanıcı deposundaki `md_<rastgele>`
   ile çakışmasınlar diye `md_caya_` önekli, ve `safeName`in izin verdiği
   karakter kümesinde.

   Liste ÖNCE kuruluyor ve Node'da da dışa veriliyor (#575): ana süreç
   küçük resim anahtarını ve artık temizliğini yerleşiklerin kaynağından
   hesaplıyor. Kayıt yalnız sayfada, `SVPresets` varken. */
(function () {
  const MD = (id, name, description, source) => ({
    id, name, description, source,
    kind: 'milkdrop', engine: 'milkdrop', tags: ['milkdrop'],
    builtin: true, author: 'CAYADEV',
  });

  const LIST = [
    MD('md_caya_aurora', 'Kutup Işığı',
      'Akışkan bir bulutsu: warp ağı basla açılıp kapanıyor, halka dalga ortada bir çekirdek besliyor.',
      `[preset00]
fRating=5.000
fGammaAdj=1.010
fDecay=0.952
fVideoEchoZoom=1.012
fVideoEchoAlpha=0.140
nVideoEchoOrientation=3
nWaveMode=2
bAdditiveWaves=1
bWaveDots=0
bWaveThick=1
bModWaveAlphaByVolume=1
bMaximizeWaveColor=0
bTexWrap=1
bDarkenCenter=0
bBrighten=0
bDarken=0
bSolarize=0
bInvert=0
fModWaveAlphaStart=0.700
fModWaveAlphaEnd=0.950
fWarpAnimSpeed=1.300
fWarpScale=1.400
fZoomExponent=1.030
fShader=0.700
zoom=1.008
rot=0.010
cx=0.500
cy=0.500
dx=0.000
dy=0.000
warp=0.800
sx=1.000
sy=1.000
wave_x=0.500
wave_y=0.500
wave_r=0.800
wave_g=0.500
wave_b=1.000
wave_a=0.550
fWaveScale=1.600
fWaveSmoothing=0.750
fWaveParam=0.300
ob_size=0.004
ob_r=0.250
ob_g=0.060
ob_b=0.450
ob_a=0.350
ib_size=0.010
ib_r=0.900
ib_g=0.400
ib_b=1.000
ib_a=0.070
nMotionVectorsX=28.000
nMotionVectorsY=21.000
mv_dx=0.000
mv_dy=0.000
mv_l=0.900
mv_r=0.450
mv_g=0.200
mv_b=0.900
mv_a=0.110
per_frame_init_1=q20 = 0;
per_frame_1=q1 = bass_att;
per_frame_2=q2 = treb_att;
per_frame_3=q3 = 0.5 + 0.5*sin(time*0.11);
per_frame_4=zoom = 1.007 + 0.011*q1;
per_frame_5=rot = 0.009 + 0.010*sin(time*0.19);
per_frame_6=warp = 0.55 + 0.55*q1;
per_frame_7=cx = 0.5 + 0.07*sin(time*0.17);
per_frame_8=cy = 0.5 + 0.07*cos(time*0.13);
per_frame_9=decay = 0.948 + 0.012*q3;
per_frame_10=wave_r = 0.55 + 0.45*sin(time*0.37);
per_frame_11=wave_g = 0.55 + 0.45*sin(time*0.37 + 2.09);
per_frame_12=wave_b = 0.55 + 0.45*sin(time*0.37 + 4.19);
per_frame_13=q4 = 0.5 + 0.5*sin(time*0.23);
per_pixel_1=zoom = zoom + 0.022*sin(rad*8 - time*1.30);
per_pixel_2=rot = rot + 0.032*sin(ang*3 + time*0.60)*rad;
per_pixel_3=dx = 0.0022*cos(ang*5 - time*0.80)*(1 - rad);
per_pixel_4=dy = 0.0022*sin(ang*4 + time*0.60)*(1 - rad);
shapecode_0_enabled=1
shapecode_0_sides=72
shapecode_0_additive=1
shapecode_0_thickOutline=0
shapecode_0_textured=0
shapecode_0_num_inst=1
shapecode_0_x=0.500
shapecode_0_y=0.500
shapecode_0_rad=0.260
shapecode_0_ang=0.000
shapecode_0_tex_ang=0.000
shapecode_0_tex_zoom=1.000
shapecode_0_r=0.900
shapecode_0_g=0.350
shapecode_0_b=1.000
shapecode_0_a=0.070
shapecode_0_r2=0.150
shapecode_0_g2=0.050
shapecode_0_b2=0.450
shapecode_0_a2=0.000
shapecode_0_border_r=1.000
shapecode_0_border_g=0.700
shapecode_0_border_b=1.000
shapecode_0_border_a=0.110
shape_0_per_frame1=rad = 0.20 + 0.16*bass_att;
shape_0_per_frame2=ang = time*0.30;
shape_0_per_frame3=r = 0.55 + 0.45*sin(time*0.41);
shape_0_per_frame4=g = 0.35 + 0.35*sin(time*0.41 + 2.09);
shape_0_per_frame5=b = 0.55 + 0.45*sin(time*0.41 + 4.19);
shape_0_per_frame6=a = 0.04 + 0.07*bass_att;
shape_0_per_frame7=border_a = 0.06 + 0.10*treb_att;
shapecode_1_enabled=1
shapecode_1_sides=6
shapecode_1_additive=1
shapecode_1_thickOutline=1
shapecode_1_textured=0
shapecode_1_num_inst=5
shapecode_1_x=0.500
shapecode_1_y=0.500
shapecode_1_rad=0.120
shapecode_1_ang=0.000
shapecode_1_r=1.000
shapecode_1_g=0.600
shapecode_1_b=0.300
shapecode_1_a=0.000
shapecode_1_r2=1.000
shapecode_1_g2=0.300
shapecode_1_b2=0.700
shapecode_1_a2=0.000
shapecode_1_border_r=1.000
shapecode_1_border_g=0.850
shapecode_1_border_b=0.600
shapecode_1_border_a=0.180
shape_1_per_frame1=q10 = instance/5;
shape_1_per_frame2=ang = time*0.45 + q10*6.283;
shape_1_per_frame3=rad = 0.30 + 0.10*sin(time*0.7 + q10*6.283) + 0.08*treb_att;
shape_1_per_frame4=x = 0.5 + 0.30*cos(time*0.33 + q10*6.283);
shape_1_per_frame5=y = 0.5 + 0.30*sin(time*0.33 + q10*6.283);
shape_1_per_frame6=border_a = 0.09 + 0.13*treb_att;
shape_1_per_frame7=border_r = 0.6 + 0.4*sin(time*0.6 + q10*3.1);
shape_1_per_frame8=border_b = 0.6 + 0.4*cos(time*0.6 + q10*3.1);
wavecode_0_enabled=1
wavecode_0_samples=384
wavecode_0_bSpectrum=0
wavecode_0_bUseDots=0
wavecode_0_bDrawThick=1
wavecode_0_bAdditive=0
wavecode_0_scaling=1.400
wavecode_0_smoothing=0.800
wavecode_0_r=1.000
wavecode_0_g=0.750
wavecode_0_b=0.950
wavecode_0_a=0.260
wave_0_per_frame1=t1 = time*0.25;
wave_0_per_point1=t2 = sample*6.2832;
wave_0_per_point2=rad0 = 0.32 + 0.14*value1 + 0.05*sin(t2*3 + t1*4);
wave_0_per_point3=x = 0.5 + rad0*cos(t2 + t1);
wave_0_per_point4=y = 0.5 + rad0*sin(t2 + t1);
wave_0_per_point5=r = 0.6 + 0.4*sin(t2*2 + time*0.9);
wave_0_per_point6=g = 0.5 + 0.4*sin(t2*2 + time*0.9 + 2.09);
wave_0_per_point7=b = 0.7 + 0.3*sin(t2*2 + time*0.9 + 4.19);
wave_0_per_point8=a = 0.18 + 0.18*value2;`),
    MD('md_caya_altin', 'Erimiş Altın',
      'Abartılı olan: hızlı warp, kalın çokgenler ve hareket vektörleri; sıcak alanın üstünde soğuk şimşekler.',
      `[preset00]
fRating=5.000
fGammaAdj=0.940
fDecay=0.902
fVideoEchoZoom=0.985
fVideoEchoAlpha=0.120
nVideoEchoOrientation=1
nWaveMode=7
bAdditiveWaves=1
bWaveDots=0
bWaveThick=1
bModWaveAlphaByVolume=0
bMaximizeWaveColor=0
bTexWrap=1
bDarkenCenter=0
bBrighten=0
bDarken=0
bSolarize=0
bInvert=0
fWarpAnimSpeed=2.400
fWarpScale=0.850
fZoomExponent=1.180
fShader=0.900
zoom=1.014
rot=0.000
cx=0.500
cy=0.500
dx=0.000
dy=0.000
warp=1.400
sx=1.000
sy=1.000
wave_x=0.500
wave_y=0.500
wave_r=1.000
wave_g=0.300
wave_b=0.100
wave_a=0.420
fWaveScale=2.200
fWaveSmoothing=0.300
fWaveParam=0.700
ob_size=0.010
ob_r=1.000
ob_g=0.250
ob_b=0.000
ob_a=0.500
ib_size=0.016
ib_r=0.100
ib_g=0.950
ib_b=1.000
ib_a=0.110
nMotionVectorsX=48.000
nMotionVectorsY=36.000
mv_dx=0.000
mv_dy=0.000
mv_l=1.600
mv_r=1.000
mv_g=0.700
mv_b=0.100
mv_a=0.280
per_frame_1=q1 = bass_att;
per_frame_2=q2 = treb_att;
per_frame_3=q3 = mid_att;
per_frame_4=zoom = 1.010 + 0.048*q1;
per_frame_5=rot = 0.030*sin(time*0.83) + 0.028*q2;
per_frame_6=warp = 1.10 + 0.90*q3;
per_frame_7=cx = 0.5 + 0.13*sin(time*0.91);
per_frame_8=cy = 0.5 + 0.13*cos(time*1.17);
per_frame_9=decay = 0.892 + 0.022*q1;
per_frame_10=wave_r = 0.10 + 0.25*abs(sin(time*0.37));
per_frame_11=wave_g = 0.55 + 0.45*abs(sin(time*0.61));
per_frame_12=wave_b = 0.80 + 0.20*abs(sin(time*0.23));
per_frame_13=mv_a = 0.10 + 0.16*q2;
per_frame_14=echo_alpha = 0.09 + 0.10*q1;
per_pixel_1=zoom = zoom + 0.060*sin(rad*14 - time*3.1);
per_pixel_2=rot = rot + 0.090*sin(ang*5 + time*1.7)*rad;
per_pixel_3=dx = 0.0060*cos(ang*9 - time*2.3);
per_pixel_4=dy = 0.0060*sin(ang*7 + time*1.9);
shapecode_0_enabled=1
shapecode_0_sides=3
shapecode_0_additive=1
shapecode_0_thickOutline=1
shapecode_0_textured=0
shapecode_0_num_inst=12
shapecode_0_x=0.500
shapecode_0_y=0.500
shapecode_0_rad=0.150
shapecode_0_ang=0.000
shapecode_0_r=1.000
shapecode_0_g=0.400
shapecode_0_b=0.000
shapecode_0_a=0.000
shapecode_0_r2=1.000
shapecode_0_g2=0.900
shapecode_0_b2=0.200
shapecode_0_a2=0.000
shapecode_0_border_r=1.000
shapecode_0_border_g=0.600
shapecode_0_border_b=0.100
shapecode_0_border_a=0.170
shape_0_per_frame1=q11 = instance/12;
shape_0_per_frame2=sides = 3 + 5*q11;
shape_0_per_frame3=ang = time*1.3 + q11*6.283;
shape_0_per_frame4=rad = 0.10 + 0.32*q11 + 0.10*bass_att;
shape_0_per_frame5=x = 0.5 + 0.34*cos(time*0.7 + q11*12.566);
shape_0_per_frame6=y = 0.5 + 0.34*sin(time*0.9 + q11*12.566);
shape_0_per_frame7=border_r = 0.5 + 0.5*sin(time*2.1 + q11*6.283);
shape_0_per_frame8=border_g = 0.5 + 0.5*sin(time*2.1 + q11*6.283 + 2.09);
shape_0_per_frame9=border_b = 0.5 + 0.5*sin(time*2.1 + q11*6.283 + 4.19);
shape_0_per_frame10=border_a = 0.06 + 0.15*treb_att;
shape_0_per_frame11=thick = 1;
shapecode_1_enabled=1
shapecode_1_sides=100
shapecode_1_additive=1
shapecode_1_thickOutline=0
shapecode_1_textured=0
shapecode_1_num_inst=1
shapecode_1_x=0.500
shapecode_1_y=0.500
shapecode_1_rad=0.100
shapecode_1_r=1.000
shapecode_1_g=0.950
shapecode_1_b=0.800
shapecode_1_a=0.130
shapecode_1_r2=1.000
shapecode_1_g2=0.200
shapecode_1_b2=0.000
shapecode_1_a2=0.000
shapecode_1_border_a=0.000
shape_1_per_frame1=rad = 0.045 + 0.13*bass_att*bass_att;
shape_1_per_frame2=a = 0.05 + 0.14*bass_att;
wavecode_0_enabled=1
wavecode_0_samples=512
wavecode_0_bSpectrum=1
wavecode_0_bUseDots=0
wavecode_0_bDrawThick=1
wavecode_0_bAdditive=1
wavecode_0_scaling=2.600
wavecode_0_smoothing=0.400
wavecode_0_r=0.250
wavecode_0_g=0.850
wavecode_0_b=1.000
wavecode_0_a=0.240
wave_0_per_point1=t2 = sample*6.2832;
wave_0_per_point2=rad0 = 0.14 + 1.30*value1;
wave_0_per_point3=x = 0.5 + rad0*cos(t2*3 + time*0.8)*0.75;
wave_0_per_point4=y = 0.5 + rad0*sin(t2*3 + time*0.8);
wave_0_per_point5=r = 0.15 + 0.35*value1;
wave_0_per_point6=g = 0.70 + 0.30*value1;
wave_0_per_point7=b = 1.0;
wave_0_per_point8=a = 0.14 + 0.22*value1;`),
    MD('md_caya_dingin', 'Dingin Halkalar',
      'Yavaş ve sade: siyah üstünde nefes alan birkaç halka, noktalarla çizilen tek bir dalga.',
      `[preset00]
fRating=5.000
fGammaAdj=1.000
fDecay=0.970
fVideoEchoZoom=1.004
fVideoEchoAlpha=0.120
nVideoEchoOrientation=0
nWaveMode=0
bAdditiveWaves=0
bWaveDots=0
bWaveThick=0
bModWaveAlphaByVolume=1
bMaximizeWaveColor=0
bTexWrap=1
bDarkenCenter=0
bBrighten=0
bDarken=0
bSolarize=0
bInvert=0
fModWaveAlphaStart=0.600
fModWaveAlphaEnd=0.900
fWarpAnimSpeed=0.450
fWarpScale=1.800
fZoomExponent=0.960
fShader=0.350
zoom=1.002
rot=0.002
cx=0.500
cy=0.500
dx=0.000
dy=0.000
warp=0.240
sx=1.000
sy=1.000
wave_x=0.500
wave_y=0.500
wave_r=0.750
wave_g=0.900
wave_b=1.000
wave_a=0.420
fWaveScale=0.900
fWaveSmoothing=0.900
fWaveParam=0.000
ob_size=0.020
ob_r=0.040
ob_g=0.070
ob_b=0.140
ob_a=0.450
ib_size=0.004
ib_r=0.700
ib_g=0.850
ib_b=1.000
ib_a=0.060
nMotionVectorsX=12.000
nMotionVectorsY=9.000
mv_a=0.000
per_frame_1=q1 = bass_att;
per_frame_2=q2 = 0.5 + 0.5*sin(time*0.07);
per_frame_3=zoom = 1.0012 + 0.0022*q1;
per_frame_4=rot = 0.0018 + 0.0022*sin(time*0.09);
per_frame_5=warp = 0.22 + 0.18*q2;
per_frame_6=cx = 0.5 + 0.10*sin(time*0.043);
per_frame_7=cy = 0.5 + 0.08*cos(time*0.037);
per_frame_8=wave_r = 0.60 + 0.25*sin(time*0.13);
per_frame_9=wave_g = 0.70 + 0.20*sin(time*0.13 + 2.09);
per_frame_10=wave_b = 0.80 + 0.20*sin(time*0.13 + 4.19);
per_frame_11=decay = 0.966 + 0.008*q2;
per_pixel_1=zoom = zoom + 0.0040*sin(rad*3 - time*0.31);
per_pixel_2=rot = rot + 0.0060*sin(ang*2 + time*0.17)*rad;
per_pixel_3=dx = 0.0009*cos(ang*3 - time*0.23)*(1 - rad*0.7);
per_pixel_4=dy = 0.0009*sin(ang*2 + time*0.19)*(1 - rad*0.7);
shapecode_0_enabled=1
shapecode_0_sides=100
shapecode_0_additive=1
shapecode_0_thickOutline=0
shapecode_0_textured=0
shapecode_0_num_inst=3
shapecode_0_x=0.500
shapecode_0_y=0.500
shapecode_0_rad=0.320
shapecode_0_ang=0.000
shapecode_0_r=0.550
shapecode_0_g=0.780
shapecode_0_b=1.000
shapecode_0_a=0.048
shapecode_0_r2=0.100
shapecode_0_g2=0.160
shapecode_0_b2=0.300
shapecode_0_a2=0.000
shapecode_0_border_r=0.800
shapecode_0_border_g=0.930
shapecode_0_border_b=1.000
shapecode_0_border_a=0.075
shape_0_per_frame1=q12 = instance/3;
shape_0_per_frame2=rad = 0.20 + 0.26*q12 + 0.045*bass_att;
shape_0_per_frame3=x = 0.5 + 0.10*cos(time*0.11 + q12*6.283);
shape_0_per_frame4=y = 0.5 + 0.10*sin(time*0.13 + q12*6.283);
shape_0_per_frame5=r = 0.45 + 0.30*sin(time*0.17 + q12*2.1);
shape_0_per_frame6=g = 0.65 + 0.25*sin(time*0.17 + q12*2.1 + 2.09);
shape_0_per_frame7=b = 0.85 + 0.15*sin(time*0.17 + q12*2.1 + 4.19);
shape_0_per_frame8=a = 0.026 + 0.042*bass_att;
shape_0_per_frame9=border_a = 0.045 + 0.065*treb_att;
wavecode_0_enabled=1
wavecode_0_samples=256
wavecode_0_bSpectrum=0
wavecode_0_bUseDots=1
wavecode_0_bDrawThick=0
wavecode_0_bAdditive=1
wavecode_0_scaling=0.800
wavecode_0_smoothing=0.920
wavecode_0_r=0.850
wavecode_0_g=0.950
wavecode_0_b=1.000
wavecode_0_a=0.300
wave_0_per_frame1=t1 = time*0.06;
wave_0_per_point1=t2 = sample*6.2832;
wave_0_per_point2=rad0 = 0.40 + 0.05*value1;
wave_0_per_point3=x = 0.5 + rad0*cos(t2 + t1)*0.62;
wave_0_per_point4=y = 0.5 + rad0*sin(t2 + t1);
wave_0_per_point5=a = 0.14 + 0.20*abs(value1);`),
    MD('md_caya_tunel', 'Sonsuz Tünel',
      'Klasik MilkDrop akışı: yarıçapa göre üslenen zum, dönen halkalar ve uçta parlayan bir çekirdek.',
      `[preset00]
fRating=5.000
fGammaAdj=1.020
fDecay=0.946
fVideoEchoZoom=1.000
fVideoEchoAlpha=0.000
nVideoEchoOrientation=0
nWaveMode=1
bAdditiveWaves=1
bWaveDots=0
bWaveThick=1
bModWaveAlphaByVolume=1
bMaximizeWaveColor=0
bTexWrap=0
bDarkenCenter=1
bBrighten=0
bDarken=0
bSolarize=0
bInvert=0
fModWaveAlphaStart=0.700
fModWaveAlphaEnd=1.000
fWarpAnimSpeed=0.700
fWarpScale=1.000
fZoomExponent=1.680
fShader=0.500
zoom=1.042
rot=0.006
cx=0.500
cy=0.500
dx=0.000
dy=0.000
warp=0.120
sx=1.000
sy=1.000
wave_x=0.500
wave_y=0.500
wave_r=0.300
wave_g=0.900
wave_b=1.000
wave_a=0.340
fWaveScale=1.100
fWaveSmoothing=0.650
fWaveParam=-0.300
ob_size=0.006
ob_r=0.000
ob_g=0.180
ob_b=0.250
ob_a=0.600
ib_size=0.002
ib_r=0.400
ib_g=1.000
ib_b=1.000
ib_a=0.250
nMotionVectorsX=16.000
nMotionVectorsY=12.000
mv_a=0.000
per_frame_1=q1 = bass_att;
per_frame_2=q2 = treb_att;
per_frame_3=zoom = 1.034 + 0.026*q1;
per_frame_4=rot = 0.005 + 0.010*sin(time*0.23);
per_frame_5=zoomexp = 1.55 + 0.30*sin(time*0.13);
per_frame_6=cx = 0.5 + 0.035*sin(time*0.29);
per_frame_7=cy = 0.5 + 0.035*cos(time*0.31);
per_frame_8=warp = 0.08 + 0.14*q2;
per_frame_9=wave_r = 0.25 + 0.25*sin(time*0.47);
per_frame_10=wave_g = 0.70 + 0.30*sin(time*0.47 + 2.09);
per_frame_11=wave_b = 0.85 + 0.15*sin(time*0.47 + 4.19);
per_frame_12=decay = 0.938 + 0.014*q1;
per_pixel_1=rot = rot + 0.020*sin(rad*5 - time*0.7)*(1 - rad);
per_pixel_2=dx = 0.0012*cos(ang*6 + time*0.5)*rad;
per_pixel_3=dy = 0.0012*sin(ang*6 + time*0.5)*rad;
shapecode_0_enabled=1
shapecode_0_sides=64
shapecode_0_additive=1
shapecode_0_thickOutline=1
shapecode_0_textured=0
shapecode_0_num_inst=4
shapecode_0_x=0.500
shapecode_0_y=0.500
shapecode_0_rad=0.420
shapecode_0_ang=0.000
shapecode_0_r=0.000
shapecode_0_g=0.000
shapecode_0_b=0.000
shapecode_0_a=0.000
shapecode_0_r2=0.000
shapecode_0_g2=0.000
shapecode_0_b2=0.000
shapecode_0_a2=0.000
shapecode_0_border_r=0.350
shapecode_0_border_g=1.000
shapecode_0_border_b=1.000
shapecode_0_border_a=0.220
shape_0_per_frame1=q13 = instance/4;
shape_0_per_frame2=rad = 0.44 - 0.10*q13 + 0.05*bass_att;
shape_0_per_frame3=ang = time*0.20 + q13*0.8;
shape_0_per_frame4=border_r = 0.20 + 0.45*sin(time*0.6 + q13*3.1);
shape_0_per_frame5=border_g = 0.70 + 0.30*sin(time*0.6 + q13*3.1 + 2.09);
shape_0_per_frame6=border_b = 0.90 + 0.10*sin(time*0.6 + q13*3.1 + 4.19);
shape_0_per_frame7=border_a = 0.10 + 0.16*bass_att;
shapecode_1_enabled=1
shapecode_1_sides=5
shapecode_1_additive=1
shapecode_1_thickOutline=1
shapecode_1_textured=0
shapecode_1_num_inst=8
shapecode_1_x=0.500
shapecode_1_y=0.500
shapecode_1_rad=0.060
shapecode_1_a=0.000
shapecode_1_a2=0.000
shapecode_1_border_r=1.000
shapecode_1_border_g=0.900
shapecode_1_border_b=0.500
shapecode_1_border_a=0.250
shape_1_per_frame1=q14 = instance/8;
shape_1_per_frame2=ang = -time*0.6 + q14*6.283;
shape_1_per_frame3=rad = 0.035 + 0.020*sin(time*1.1 + q14*6.283);
shape_1_per_frame4=x = 0.5 + 0.22*cos(-time*0.35 + q14*6.283);
shape_1_per_frame5=y = 0.5 + 0.22*sin(-time*0.35 + q14*6.283);
shape_1_per_frame6=border_a = 0.12 + 0.22*treb_att;
wavecode_0_enabled=1
wavecode_0_samples=512
wavecode_0_bSpectrum=0
wavecode_0_bUseDots=0
wavecode_0_bDrawThick=1
wavecode_0_bAdditive=1
wavecode_0_scaling=1.000
wavecode_0_smoothing=0.700
wavecode_0_r=0.400
wavecode_0_g=1.000
wavecode_0_b=1.000
wavecode_0_a=0.200
wave_0_per_frame1=t1 = time*0.5;
wave_0_per_point1=t2 = sample*6.2832;
wave_0_per_point2=rad0 = 0.46 + 0.10*value1;
wave_0_per_point3=x = 0.5 + rad0*cos(t2 + t1)*0.60;
wave_0_per_point4=y = 0.5 + rad0*sin(t2 + t1);
wave_0_per_point5=r = 0.3 + 0.5*abs(value1);
wave_0_per_point6=g = 1.0;
wave_0_per_point7=b = 0.9;
wave_0_per_point8=a = 0.11 + 0.20*abs(value1);
shapecode_2_enabled=1
shapecode_2_sides=48
shapecode_2_additive=1
shapecode_2_thickOutline=0
shapecode_2_textured=0
shapecode_2_num_inst=1
shapecode_2_x=0.500
shapecode_2_y=0.500
shapecode_2_rad=0.055
shapecode_2_r=0.650
shapecode_2_g=1.000
shapecode_2_b=1.000
shapecode_2_a=0.280
shapecode_2_r2=0.100
shapecode_2_g2=0.300
shapecode_2_b2=0.600
shapecode_2_a2=0.000
shapecode_2_border_a=0.000
shape_2_per_frame1=rad = 0.038 + 0.055*bass_att;
shape_2_per_frame2=a = 0.16 + 0.26*bass_att;
shape_2_per_frame3=r = 0.45 + 0.35*sin(time*0.53);
shape_2_per_frame4=g = 0.80 + 0.20*sin(time*0.53 + 2.09);
shape_2_per_frame5=b = 0.90 + 0.10*sin(time*0.53 + 4.19);`),
    MD('md_caya_nabiz', 'Nabız Örgüsü',
      'Grafik olan: vuruşla zıplayan kareler, iki tayf dalgası ve hareket vektörlerinin dokuduğu örgü.',
      `[preset00]
fRating=5.000
fGammaAdj=0.960
fDecay=0.900
fVideoEchoZoom=1.030
fVideoEchoAlpha=0.250
nVideoEchoOrientation=2
nWaveMode=6
bAdditiveWaves=1
bWaveDots=0
bWaveThick=1
bModWaveAlphaByVolume=0
bMaximizeWaveColor=0
bTexWrap=1
bDarkenCenter=0
bBrighten=0
bDarken=0
bSolarize=0
bInvert=0
fWarpAnimSpeed=1.000
fWarpScale=0.600
fZoomExponent=1.000
fShader=0.150
zoom=1.000
rot=0.000
cx=0.500
cy=0.500
dx=0.000
dy=0.000
warp=0.050
sx=1.000
sy=1.000
wave_x=0.500
wave_y=0.500
wave_r=1.000
wave_g=1.000
wave_b=1.000
wave_a=0.520
fWaveScale=1.800
fWaveSmoothing=0.250
fWaveParam=0.000
ob_size=0.030
ob_r=0.020
ob_g=0.020
ob_b=0.040
ob_a=1.000
ib_size=0.003
ib_r=0.900
ib_g=0.400
ib_b=0.900
ib_a=0.260
nMotionVectorsX=64.000
nMotionVectorsY=48.000
mv_dx=0.000
mv_dy=0.000
mv_l=0.700
mv_r=1.000
mv_g=0.150
mv_b=0.450
mv_a=0.180
per_frame_1=q1 = bass_att;
per_frame_2=q2 = treb_att;
per_frame_3=zoom = 0.996 + 0.030*q1*q1;
per_frame_4=sx = 1.000 + 0.020*q1;
per_frame_5=sy = 1.000 - 0.012*q1;
per_frame_6=rot = 0.004*sin(time*0.37);
per_frame_7=dx = 0.0030*sin(time*0.53);
per_frame_8=warp = 0.03 + 0.09*q2;
per_frame_9=decay = 0.885 + 0.035*q1;
per_frame_10=wave_r = 0.55 + 0.45*abs(sin(time*0.19 + 0.8));
per_frame_11=wave_g = 0.20 + 0.45*abs(sin(time*0.21));
per_frame_12=wave_b = 0.45 + 0.45*abs(sin(time*0.17 + 1.6));
per_frame_13=mv_a = 0.08 + 0.18*q1;
per_frame_14=mv_g = 0.15 + 0.60*abs(sin(time*0.23));
per_frame_15=mv_b = 0.45 + 0.50*abs(sin(time*0.31 + 1.1));
per_pixel_1=dy = 0.0025*sin(x*9.4 + time*1.3)*(1 - rad*0.5);
per_pixel_2=zoom = zoom + 0.012*sin(y*7.5 - time*0.9);
shapecode_0_enabled=1
shapecode_0_sides=4
shapecode_0_additive=1
shapecode_0_thickOutline=1
shapecode_0_textured=0
shapecode_0_num_inst=9
shapecode_0_x=0.500
shapecode_0_y=0.500
shapecode_0_rad=0.090
shapecode_0_ang=0.785
shapecode_0_r=1.000
shapecode_0_g=0.100
shapecode_0_b=0.350
shapecode_0_a=0.000
shapecode_0_r2=0.200
shapecode_0_g2=0.000
shapecode_0_b2=0.400
shapecode_0_a2=0.000
shapecode_0_border_r=0.250
shapecode_0_border_g=0.950
shapecode_0_border_b=1.000
shapecode_0_border_a=0.270
shape_0_per_frame1=q15 = instance/9;
shape_0_per_frame2=x = 0.11 + q15*0.78;
shape_0_per_frame3=y = 0.5 + 0.26*sin(time*1.1 + q15*6.283);
shape_0_per_frame4=rad = 0.030 + 0.085*bass_att*(0.4 + 0.6*abs(sin(q15*9.42 + time)));
shape_0_per_frame5=ang = time*0.9 + q15*3.14;
shape_0_per_frame6=border_a = 0.12 + 0.20*bass_att;
shape_0_per_frame7=a = 0.03 + 0.10*bass_att;
shape_0_per_frame8=thick = 1;
wavecode_0_enabled=1
wavecode_0_samples=512
wavecode_0_bSpectrum=1
wavecode_0_bUseDots=0
wavecode_0_bDrawThick=1
wavecode_0_bAdditive=1
wavecode_0_scaling=1.700
wavecode_0_smoothing=0.150
wavecode_0_r=1.000
wavecode_0_g=0.200
wavecode_0_b=0.500
wavecode_0_a=0.330
wave_0_per_point1=x = sample;
wave_0_per_point2=y = 0.88 - 0.62*value1;
wave_0_per_point3=r = 0.9 - 0.4*value1;
wave_0_per_point4=g = 0.1 + 0.6*value1;
wave_0_per_point5=b = 0.4 + 0.4*value1;
wave_0_per_point6=a = 0.18 + 0.30*value1;
wavecode_1_enabled=1
wavecode_1_samples=512
wavecode_1_bSpectrum=1
wavecode_1_bUseDots=0
wavecode_1_bDrawThick=1
wavecode_1_bAdditive=1
wavecode_1_scaling=1.700
wavecode_1_smoothing=0.150
wavecode_1_r=0.300
wavecode_1_g=0.700
wavecode_1_b=1.000
wavecode_1_a=0.260
wave_1_per_point1=x = sample;
wave_1_per_point2=y = 0.12 + 0.62*value1;
wave_1_per_point3=a = 0.14 + 0.26*value1;`),
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = LIST;
  const P = typeof window !== 'undefined' ? window.SVPresets : null;
  if (!P || !P.registerBuiltin) return;
  /* Aynı sayfada iki kez değerlendirilirse `registerBuiltin` yinelenen
     kimlik için hata atıyor ve kayıt yarıda kalıyor. Nöbetçi, ikinci
     değerlendirmeyi sessizce geçiyor. */
  if (window.__SVMilkdropBuiltins) return;
  window.__SVMilkdropBuiltins = true;
  P.registerBuiltin(LIST);
  window.SVMilkdropBuiltins = LIST;
})();
