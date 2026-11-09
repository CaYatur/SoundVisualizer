; SoundVisualizer — Windows kısayolları (yalnız NSIS)
; Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
; https://github.com/CaYatur/SoundVisualizer
; SPDX-License-Identifier: MIT
!ifndef SV_WINDOWS_SHORTCUTS_INCLUDED
!define SV_WINDOWS_SHORTCUTS_INCLUDED

!define SV_BRIDGE_MENU_FOLDER "CaYaDev Audio Tools"
!define SV_BRIDGE_SHORTCUT "CaYaDev Audio Bridge"
; Ürün adları çevrilmez. Eski arama adı açıklamada, yeni ad dosya adında kalır.
!define SV_MAIN_SHORTCUT_DESCRIPTION "CaYaDev Visualizer | CaYaDev SoundVisualizer"

!macro svCleanupLegacyWindowsShortcuts
  ; Yalnız bilinen eski adlar silinir; sabitlenen kısayollara dokunulmaz.
  Delete "$SMPROGRAMS\CAYADEV Visualizer Audio Bridge.lnk"
  Delete "$SMPROGRAMS\CAYADEV Visualizer.lnk"
  Delete "$DESKTOP\CAYADEV Visualizer.lnk"
!macroend

!macro svCleanupLegacyWindowsShortcutScopes
  !insertmacro svCleanupLegacyWindowsShortcuts
  ; Tüm kullanıcılar kurulumu, yükselen işlemin mevcut kullanıcı kalıntısını da temizler.
  ; Başka kullanıcı profilleri taranmaz; kurulumun seçtiği bağlama geri dönülür.
  ${If} $installMode == "all"
    SetShellVarContext current
    !insertmacro svCleanupLegacyWindowsShortcuts
    SetShellVarContext all
  ${EndIf}
!macroend

!macro svInstallWindowsShortcuts
  ; Builder önce mevcut kısayolu yeni adına taşır (sessiz --updated dahil).
  ; Silinen/istenmeyen ana kısayolu geri getirmeden açıklamayı yenile.
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${If} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${SV_MAIN_SHORTCUT_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${EndIf}
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${If} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${SV_MAIN_SHORTCUT_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}
  !endif
  !insertmacro svCleanupLegacyWindowsShortcutScopes
  ; Klasörde Visualizer/SoundVisualizer yok: köprü ana uygulamayla aramada yarışmaz.
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    CreateDirectory "$SMPROGRAMS\${SV_BRIDGE_MENU_FOLDER}"
    CreateShortCut "$SMPROGRAMS\${SV_BRIDGE_MENU_FOLDER}\${SV_BRIDGE_SHORTCUT}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "--bridge" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 "" "" "${SV_BRIDGE_SHORTCUT}"
  !endif
!macroend

!macro svRemoveWindowsShortcuts
  !insertmacro svCleanupLegacyWindowsShortcutScopes
  Delete "$SMPROGRAMS\${SV_BRIDGE_MENU_FOLDER}\${SV_BRIDGE_SHORTCUT}.lnk"
  ; /r yok: kullanıcı bu klasöre dosya eklediyse korunur.
  RMDir "$SMPROGRAMS\${SV_BRIDGE_MENU_FOLDER}"
  ; Yeni ana kısayol builder'a aittir; --keep-shortcuts yükseltmesini bozma.
!macroend
!endif
