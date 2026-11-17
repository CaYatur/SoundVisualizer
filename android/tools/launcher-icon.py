# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT
#
# UYGULAMA SİMGESİ: masaüstünün simgesinden (build/icon.png, 1024 px) Android'in
# uyarlanabilir simgesinin ön katmanı. 108 dp tuvale simgenin tamamı oturuyor; launcher
# ortadaki ~72 dp'yi gösteriyor (lacivert zemin ve ses çubukları), zemin rengi
# res/values/colors.xml'de (assets/icon.svg'deki zemin). Simge değişirse yeniden çalıştırın:
#
#   python android/tools/launcher-icon.py
#
# Pillow gerekir; çıktılar depoya giriyor (derleme Python istemesin).
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}

src = Image.open(os.path.join(ROOT, 'build', 'icon.png')).convert('RGBA')
for name, k in DENSITIES.items():
    px = int(round(108 * k))
    folder = os.path.join(RES, 'mipmap-' + name)
    os.makedirs(folder, exist_ok=True)
    src.resize((px, px), Image.LANCZOS).save(os.path.join(folder, 'ic_launcher_foreground.png'), optimize=True)
print('ok')
