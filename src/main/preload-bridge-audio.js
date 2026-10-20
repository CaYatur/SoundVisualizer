/*
 * SoundVisualizer — CaYaDev Ses Görselleştirici
 * Copyright (c) 2026 Çağan Turgut (CaYatur) — CaYaDev, https://cayadev.com
 * https://github.com/CaYatur/SoundVisualizer
 * SPDX-License-Identifier: MIT
 */
'use strict';
/* Köprünün sesini çalan gizli pencerenin köprüsü (#813). PCM ana süreçten
   gelir; pencere durumunu ve çıkış aygıtlarını geri bildirir. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridgeAudio', {
  onPcm: (cb) => ipcRenderer.on('bridge-audio:pcm', (e, m) => cb(m)),
  onConfig: (cb) => ipcRenderer.on('bridge-audio:config', (e, c) => cb(c)),
  ready: () => ipcRenderer.send('bridge-audio:ready'),
  status: (st) => ipcRenderer.send('bridge-audio:status', st),
  outputs: (list) => ipcRenderer.send('bridge-audio:outputs', list),
});
