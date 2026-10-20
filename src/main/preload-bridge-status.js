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
  devices: () => ipcRenderer.invoke('bridge-win:devices'),
  apps: () => ipcRenderer.invoke('bridge-win:apps'),
  setSource: (src) => ipcRenderer.invoke('bridge-win:set-source', src),
  action: (what) => ipcRenderer.send('bridge-win:action', what),
  onStatus: (cb) => ipcRenderer.on('bridge-win:status', (e, s) => cb(s)),
  onLevel: (cb) => ipcRenderer.on('bridge-win:level', (e, l) => cb(l)),
});
