/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Köprü kipinin durum penceresinin köprüsü (#813). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridgeWin', {
  status: () => ipcRenderer.invoke('bridge-win:status'),
  onTheme: (cb) => ipcRenderer.on('bridge-win:theme', (e, t) => cb(t)),
  devices: () => ipcRenderer.invoke('bridge-win:devices'),
  // Uygulamanın Ses Kaynakları seçicisiyle aynı veriler (#813)
  setSources: (list) => ipcRenderer.invoke('bridge-win:set-sources', list),
  appStatus: () => ipcRenderer.invoke('bridge-win:app-status'),
  appList: () => ipcRenderer.invoke('bridge-win:app-list'),
  requestPermission: () => ipcRenderer.invoke('bridge-win:request-permission'),
  appMeters: (on) => ipcRenderer.send('bridge-win:app-meters', !!on),
  onAppLevels: (cb) => ipcRenderer.on('bridge-win:app-levels', (e, d) => cb(d)),
  action: (what) => ipcRenderer.send('bridge-win:action', what),
  onStatus: (cb) => ipcRenderer.on('bridge-win:status', (e, s) => cb(s)),
  onLevel: (cb) => ipcRenderer.on('bridge-win:level', (e, l) => cb(l)),
});
