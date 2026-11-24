/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
// mdref — MilkDrop 2 referans çizici (#580). BeatDrop kaynakları depoya girmez; setup ile indirilir.
//
// BeatDrop'un (mvsoft74/BeatDrop 53d83ee, BSD-3) vis_milk2 çekirdeğini kendi
// penceresi ve ses yakalaması OLMADAN sürer: sabit PCM, sabit kare adımı,
// belirli karelerde arka tamponu diske yazar. Böylece aynı preset, aynı ses
// ve aynı kare bizim motorla piksel piksel karşılaştırılabiliyor.
//
// Kullanım:
//   mdref.exe --preset <tam yol .milk> --out <klasör> [--w 960] [--h 720]
//             [--frames 60] [--cap 59,58] [--audio <ham.i8>] [--seed 1]
//             [--fps 30] [--mesh 64]
// Ses dosyası: kare başına 576 sol + 576 sağ işaretli 8 bit örnek (±128 birimi).
// Çıktı: <out>/f<kare>.bgra (W*H*4, satır satır, üstten) ve .png, <out>/ok.txt
#include <windows.h>
#include <d3d9.h>
#include <d3dx9.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <vector>
#include <set>
#include <locale.h>
#include "vis_milk2/plugin.h"

CPlugin g_plugin;
HINSTANCE api_orig_hinstance = nullptr;
_locale_t g_use_C_locale;
char keyMappings[8];

extern float g_mdrefFps;
extern void (*g_mdrefHook)(LPDIRECT3DDEVICE9);

static int W = 960, H = 720, FRAMES = 60, SEED = 1, MESH = 64, WARM = 0;
static float FPS = 30;
static std::wstring PRESET, OUTDIR, AUDIO, BLANK;
static std::set<int> CAP;
static int g_frame = 0;
static FILE* g_log = nullptr;

static void logf(const char* fmt, ...) {
  va_list a; va_start(a, fmt);
  if (g_log) { vfprintf(g_log, fmt, a); fflush(g_log); }
  va_end(a);
}

static void capture(LPDIRECT3DDEVICE9 dev) {
  if (!CAP.count(g_frame)) return;
  IDirect3DSurface9* rt = nullptr;
  if (FAILED(dev->GetRenderTarget(0, &rt)) || !rt) { logf("rt yok %d\n", g_frame); return; }
  D3DSURFACE_DESC d; rt->GetDesc(&d);
  IDirect3DSurface9* sys = nullptr;
  if (FAILED(dev->CreateOffscreenPlainSurface(d.Width, d.Height, d.Format, D3DPOOL_SYSTEMMEM, &sys, nullptr))) {
    logf("sys yüzey yok\n"); rt->Release(); return;
  }
  if (FAILED(dev->GetRenderTargetData(rt, sys))) { logf("GetRenderTargetData hata\n"); }
  D3DLOCKED_RECT lr;
  if (SUCCEEDED(sys->LockRect(&lr, nullptr, D3DLOCK_READONLY))) {
    wchar_t p[MAX_PATH];
    swprintf(p, MAX_PATH, L"%s\\f%d.bgra", OUTDIR.c_str(), g_frame);
    FILE* f = _wfopen(p, L"wb");
    for (UINT y = 0; y < d.Height; y++) fwrite((char*)lr.pBits + y * lr.Pitch, 1, d.Width * 4, f);
    fclose(f);
    sys->UnlockRect();
  }
  wchar_t pp[MAX_PATH];
  swprintf(pp, MAX_PATH, L"%s\\f%d.png", OUTDIR.c_str(), g_frame);
  D3DXSaveSurfaceToFileW(pp, D3DXIFF_PNG, sys, nullptr, nullptr);
  logf("kare %d %ux%u fmt %d\n", g_frame, d.Width, d.Height, (int)d.Format);
  sys->Release(); rt->Release();
}

static LRESULT CALLBACK WndProc(HWND h, UINT m, WPARAM w, LPARAM l) {
  if (m == WM_CLOSE) { DestroyWindow(h); return 0; }
  if (m == WM_DESTROY) { PostQuitMessage(0); return 0; }
  return DefWindowProcW(h, m, w, l);
}

static void writeIni(const wchar_t* dir) {
  // Ölçüm için sabit ayarlar: yazı yok, kilit açık, sert kesme yok, doku = pencere
  std::wstring p = std::wstring(dir) + L"milk2.ini";
  FILE* f = _wfopen(p.c_str(), L"w");
  fprintf(f, "[settings]\nbConfigured=1\nbShowPressF1ForHelp=0\nbShowFPS=0\nbShowRating=0\nbShowPresetInfo=0\n"
             "bShowSongTitle=0\nbShowSongTime=0\nbShowSongLen=0\nbSongTitleAnims=0\nbWarningsDisabled2=1\n"
             "bPresetLockOnAtStartup=1\nbHardCutsDisabled=1\nbEnableRating=0\nnTexSize=-1\nnTexBitsPerCh=8\n"
             "nMeshSize=%d\nMaxPSVersion=-1\nmax_fps_w=0\nmax_fps_fs=0\nmax_fps_dm=0\nnCanvasStretch=0\n"
             "fTimeBetweenPresets=100000\nfTimeBetweenPresetsRand=0\nfTimeBetweenRandomSongTitles=-1\n"
             "fTimeBetweenRandomCustomMsgs=-1\nbAutoGamma=0\nn16BitGamma=0\n", MESH);
  fclose(f);
}

int wmain(int argc, wchar_t** argv) {
  for (int i = 1; i + 1 < argc; i += 2) {
    std::wstring k = argv[i], v = argv[i + 1];
    if (k == L"--preset") PRESET = v;
    else if (k == L"--out") OUTDIR = v;
    else if (k == L"--audio") AUDIO = v;
    else if (k == L"--w") W = _wtoi(v.c_str());
    else if (k == L"--h") H = _wtoi(v.c_str());
    else if (k == L"--frames") FRAMES = _wtoi(v.c_str());
    else if (k == L"--seed") SEED = _wtoi(v.c_str());
    else if (k == L"--fps") FPS = (float)_wtof(v.c_str());
    else if (k == L"--mesh") MESH = _wtoi(v.c_str());
    else if (k == L"--warm") WARM = _wtoi(v.c_str());
    else if (k == L"--blank") BLANK = v;
    else if (k == L"--cap") {
      const wchar_t* s = v.c_str();
      while (*s) { CAP.insert(_wtoi(s)); while (*s && *s != L',') s++; if (*s) s++; }
    }
  }
  if (PRESET.empty() || OUTDIR.empty()) { fprintf(stderr, "--preset ve --out gerekli\n"); return 2; }
  if (CAP.empty()) CAP.insert(FRAMES - 1);
  CreateDirectoryW(OUTDIR.c_str(), nullptr);
  g_log = _wfopen((OUTDIR + L"\\log.txt").c_str(), L"w");
  g_use_C_locale = _create_locale(LC_NUMERIC, "C");

  wchar_t exe[MAX_PATH]; GetModuleFileNameW(nullptr, exe, MAX_PATH);
  wchar_t* sl = wcsrchr(exe, L'\\'); if (sl) sl[1] = 0;
  writeIni(exe);

  // Ses: kare başına 1152 bayt
  std::vector<signed char> audio;
  if (!AUDIO.empty()) {
    FILE* f = _wfopen(AUDIO.c_str(), L"rb");
    if (!f) { logf("ses açılamadı\n"); return 3; }
    fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
    audio.resize(n); fread(audio.data(), 1, n, f); fclose(f);
  }

  HINSTANCE inst = GetModuleHandleW(nullptr);
  api_orig_hinstance = inst;
  WNDCLASSW wc = {}; wc.lpfnWndProc = WndProc; wc.hInstance = inst; wc.lpszClassName = L"mdref";
  wc.hbrBackground = (HBRUSH)GetStockObject(BLACK_BRUSH);
  RegisterClassW(&wc);
  RECT rc = { 0, 0, W, H }; AdjustWindowRect(&rc, WS_OVERLAPPEDWINDOW, FALSE);
  HWND hwnd = CreateWindowW(L"mdref", L"mdref", WS_OVERLAPPEDWINDOW, 0, 0, rc.right - rc.left, rc.bottom - rc.top,
                            nullptr, nullptr, inst, nullptr);
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);

  IDirect3D9* d3d = Direct3DCreate9(D3D_SDK_VERSION);
  D3DPRESENT_PARAMETERS pp = {};
  pp.BackBufferCount = 1; pp.BackBufferFormat = D3DFMT_X8R8G8B8;
  pp.BackBufferWidth = W; pp.BackBufferHeight = H;
  pp.SwapEffect = D3DSWAPEFFECT_COPY; pp.EnableAutoDepthStencil = TRUE;
  pp.AutoDepthStencilFormat = D3DFMT_D24X8; pp.Windowed = TRUE;
  pp.PresentationInterval = D3DPRESENT_INTERVAL_IMMEDIATE; pp.hDeviceWindow = hwnd;
  IDirect3DDevice9* dev = nullptr;
  HRESULT hr = d3d->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, hwnd, D3DCREATE_HARDWARE_VERTEXPROCESSING, &pp, &dev);
  if (FAILED(hr)) { logf("CreateDevice 0x%08x\n", hr); return 4; }

  g_mdrefFps = FPS;
  g_mdrefHook = capture;
  srand(SEED);
  g_plugin.PluginPreInitialize(0, 0);
  if (!g_plugin.PluginInitialize(dev, &pp, hwnd, W, H)) { logf("PluginInitialize başarısız\n"); return 5; }
  unsigned char L[576], R[576];
  /* Isınma: aynı sesle WARM kare boyunca siyah bir preset. MilkDrop'un bant
     ortalamaları oturumun başında sıfırdan başlıyor (ilk karelerde bantlar
     10'a kenetli); bizim motor tohumlayarak başlıyor. Karşılaştırmayı bu
     geçici durum değil preset belirlesin diye iki motor da ısınıyor. */
  g_plugin.m_UI_mode = UI_REGULAR;
  if (WARM > 0 && !BLANK.empty()) {
    g_plugin.LoadPreset(BLANK.c_str(), 0.0f);
    g_plugin.m_UI_mode = UI_REGULAR;
    g_frame = -1;  // yakalama yok
    for (int w = 0; w < WARM; w++) {
      MSG msg;
      while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
      size_t off = (size_t)w * 1152;
      for (int i = 0; i < 576; i++) {
        L[i] = off + 1152 <= audio.size() ? (unsigned char)audio[off + i] : 0;
        R[i] = off + 1152 <= audio.size() ? (unsigned char)audio[off + 576 + i] : 0;
      }
      g_plugin.PluginRender(L, R);
    }
  }
  srand(SEED);
  g_plugin.LoadPreset(PRESET.c_str(), 0.0f);
  g_plugin.m_UI_mode = UI_REGULAR;
  logf("preset yüklendi\n");

  FILE* bands = _wfopen((OUTDIR + L"\\bands.txt").c_str(), L"w");
  for (g_frame = 0; g_frame < FRAMES; g_frame++) {
    MSG msg;
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessageW(&msg); }
    size_t off = (size_t)(g_frame + WARM) * 1152;
    for (int i = 0; i < 576; i++) {
      L[i] = off + 1152 <= audio.size() ? (unsigned char)audio[off + i] : 0;
      R[i] = off + 1152 <= audio.size() ? (unsigned char)audio[off + 576 + i] : 0;
    }
    if (!g_plugin.PluginRender(L, R)) { logf("PluginRender false @%d\n", g_frame); break; }
    // Kare başına bantlar: bass mid treb (imm_rel) ve *_att (avg_rel)
    if (bands) fprintf(bands, "%d %.6f %.6f %.6f %.6f %.6f %.6f\n", g_frame,
      g_plugin.mysound.imm_rel[0], g_plugin.mysound.imm_rel[1], g_plugin.mysound.imm_rel[2],
      g_plugin.mysound.avg_rel[0], g_plugin.mysound.avg_rel[1], g_plugin.mysound.avg_rel[2]);
  }
  if (bands) fclose(bands);
  FILE* ok = _wfopen((OUTDIR + L"\\ok.txt").c_str(), L"w");
  if (ok) { fprintf(ok, "%d\n", g_frame); fclose(ok); }
  g_plugin.PluginQuit();
  dev->Release(); d3d->Release();
  if (g_log) fclose(g_log);
  return 0;
}
