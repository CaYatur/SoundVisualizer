@echo off
rem SoundVisualizer — CaYaDev Ses Görselleştirici
rem Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
rem https://github.com/CaYatur/SoundVisualizer
rem SPDX-License-Identifier: MIT
rem mdref: BeatDrop 53d83ee vis_milk2 + ns-eel2 (kaynaktan) + Microsoft D3DX (NuGet), x86
rem VCVARS ile vcvars32.bat yolunu, DXSDK ile D3DX kökünü (build\native) verebilirsiniz.
cd /d %~dp0

if not exist src\vis_milk2\plugin.cpp (
  echo BeatDrop kaynaklari yok. Once: node setup.js
  exit /b 1
)

if not defined VCVARS (
  set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
  for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Auxiliary\Build\vcvars32.bat 2^>nul`) do set "VCVARS=%%i"
)
if not defined VCVARS (
  echo vcvars32.bat bulunamadi. Visual Studio Build Tools ^(C++ x86^) kurun ya da VCVARS ile tam yolu verin.
  exit /b 1
)
call "%VCVARS%"
if errorlevel 1 exit /b 1

if not defined DXSDK set "DX=%~dp0d3dx\build\native"
if defined DXSDK set "DX=%DXSDK%"
if not exist "%DX%\include" (
  echo D3DX SDK yok ^("%DX%\include"^). Once: node setup.js
  exit /b 1
)

if not exist obj mkdir obj
if not exist bin mkdir bin
set DEFS=/DWIN32 /DNDEBUG /D_WINDOWS /DUSE_VIS_HDR_HWND /DSTRSAFE_NO_DEPRECATE /DNSEEL_REENTRANT_EXECUTION /D_CRT_SECURE_NO_WARNINGS /D_CRT_NON_CONFORMING_SWPRINTFS
set V=src\vis_milk2
set E=src\ns-eel2
cl /nologo /c /O2 /EHsc /W0 /MT /Zc:forScope- /FIstring /FIwindows.h %DEFS% /I"%DX%\include" /Isrc /Fo:obj\ ^
  src\mdref.cpp %V%\dxcontext.cpp %V%\fft.cpp %V%\menu.cpp %V%\milkdropfs.cpp %V%\plugin.cpp %V%\pluginshell.cpp ^
  %V%\state.cpp %V%\support.cpp %V%\texmgr.cpp %V%\textmgr.cpp %V%\utility.cpp %V%\wasabi.cpp
if errorlevel 1 exit /b 1
cl /nologo /c /O2 /W0 /MT %DEFS% /D__floor=eel_floor_fn /Fo:obj\ ^
  %E%\nseel-caltab.c %E%\nseel-cfunc.c %E%\nseel-compiler.c %E%\nseel-eval.c %E%\nseel-lextab.c %E%\nseel-ram.c %E%\nseel-yylex.c
if errorlevel 1 exit /b 1
rc /nologo /i "%V%" /i src /fo obj\plugin.res %V%\plugin.rc
if errorlevel 1 exit /b 1
link /nologo /SUBSYSTEM:CONSOLE /OUT:bin\mdref.exe obj\*.obj obj\plugin.res /LIBPATH:"%DX%\release\lib\x86" ^
  d3d9.lib d3dx9.lib shlwapi.lib user32.lib gdi32.lib winmm.lib dwmapi.lib ole32.lib comdlg32.lib shell32.lib advapi32.lib comctl32.lib
