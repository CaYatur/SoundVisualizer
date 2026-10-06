#!/usr/bin/env bash
# SoundVisualizer — CaYaDev Ses Görselleştirici
# Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
# https://github.com/CaYatur/SoundVisualizer
# SPDX-License-Identifier: MIT

# AppImage güncelleme bilgisi ve .zsync (#640).
#
# AppImageUpdate (ve AppImageLauncher gibi onu kullanan araçlar) güncellemeyi
# AppImage'in çalışma zamanındaki .upd_info ELF bölümünde yazan bilgiden
# buluyor: "gh-releases-zsync|kullanıcı|depo|latest|dosya-deseni.zsync".
# electron-builder bu bölümü boş bırakıyor; burada doğrudan yazılıyor ve
# AppImage'in yanına zsyncmake ile .zsync üretiliyor. Sürümde ikisi birlikte
# yayımlanmalı (scripts/release-assets.js .zsync'i de bekliyor).
#
# Kullanım: bash scripts/appimage-update-info.sh [dist-klasörü]
set -euo pipefail

DIST="${1:-dist}"
INFO='gh-releases-zsync|CaYatur|SoundVisualizer|latest|CAYADEV-Visualizer-*-linux-x86_64.AppImage.zsync'

shopt -s nullglob
files=("$DIST"/*-linux-x86_64.AppImage)
if [ "${#files[@]}" -ne 1 ]; then
  echo "Tam bir tane *-linux-x86_64.AppImage bekleniyordu, bulunan: ${#files[@]}" >&2
  ls -la "$DIST" >&2 || true
  exit 1
fi
f="${files[0]}"

# .upd_info bölümünün dosyadaki yeri ve boyu (objdump -h: Boyut ve Dosya ofseti)
line="$(objdump -h "$f" | awk '$2==".upd_info"{print $3, $6}')"
if [ -z "$line" ]; then
  echo "Çalışma zamanında .upd_info bölümü yok; güncelleme bilgisi yazılamaz." >&2
  exit 1
fi
read -r size_hex off_hex <<<"$line"
size=$((16#$size_hex))
off=$((16#$off_hex))
if [ "${#INFO}" -ge "$size" ]; then
  echo "Güncelleme bilgisi (${#INFO} bayt) bölüme (${size} bayt) sığmıyor." >&2
  exit 1
fi

# Önce bölümü sıfırla, sonra bilgiyi yaz (dosyanın geri kalanına dokunmadan)
dd if=/dev/zero of="$f" bs=1 seek="$off" count="$size" conv=notrunc status=none
printf '%s' "$INFO" | dd of="$f" bs=1 seek="$off" conv=notrunc status=none

# Doğrula: bölümden geri okunan metin birebir aynı mı
got="$(dd if="$f" bs=1 skip="$off" count="${#INFO}" status=none)"
if [ "$got" != "$INFO" ]; then
  echo "Yazılan bilgi geri okunamadı: '$got'" >&2
  exit 1
fi
echo "Güncelleme bilgisi yazıldı: $INFO (ofset $off, bölüm $size bayt)"
# Ek kanıt: AppImage çalışma zamanının kendisi ne diyor (FUSE gerektirmez;
# desteklemiyorsa işi düşürmez, yukarıdaki geri okuma zaten zorunlu)
echo "Çalışma zamanı: $("$f" --appimage-updateinformation 2>/dev/null || echo "(okunamadı)")"

# .zsync: URL alanı yalnız dosya adı; AppImageUpdate onu sürümün yanında arar
name="$(basename "$f")"
( cd "$(dirname "$f")" && zsyncmake -u "$name" -o "$name.zsync" "$name" )
ls -la "$f" "$f.zsync"
