'use strict';

const fs = require('fs');
const path = require('path');

/* Renk hesabı OpenRGB ile ORTAKTIR — bkz. src/shared/lighting-render.js.
   Kendi animasyon durumumuzu alıyoruz ki iki tüketici aynı karede
   zamanlayıcıyı iki kez ilerletmesin. */
const { createRenderer, DYNAMIC_MODES, STATIC_MODES } = require('../shared/lighting-render.js');
const renderer = createRenderer();
const {
  animation,
  clamp,
  normalizeLighting,
  resetAnimation,
  updateAnimation,
  renderPixel,
  layoutPosition,
} = renderer;

let nativeAddon = null;
let cachedScan = { ok: true, supported: process.platform === 'win32', devices: [] };
let currentConfig = null;
let devicesClaimed = false;


function addonPath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'runtime', 'dynamic_lighting.node'),
    path.join(__dirname, '..', '..', 'native', 'dynamic-lighting', 'build', 'Release', 'dynamic_lighting.node'),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function ensureAddon() {
  if (process.platform !== 'win32') throw new Error('Dynamic Lighting is available only on Windows.');
  if (nativeAddon) return nativeAddon;
  const binary = addonPath();
  if (!binary) throw new Error('Dynamic Lighting native module is missing.');
  nativeAddon = require(binary);
  return nativeAddon;
}

async function scan() {
  if (process.platform !== 'win32') return { ok: true, supported: false, devices: [] };
  try {
    const addon = ensureAddon();
    cachedScan = addon.scan();
    devicesClaimed = true;
    if (!currentConfig?.enabled) {
      addon.release();
      devicesClaimed = false;
    }
    return cachedScan;
  } catch (error) {
    devicesClaimed = false;
    cachedScan = { ok: false, supported: true, devices: [], error: error.message };
    return cachedScan;
  }
}

async function setConfig(config) {
  const next = normalizeLighting(config);
  if (next.mode !== animation.mode) resetAnimation(next.mode);
  currentConfig = next;

  if (process.platform !== 'win32') return { ok: true, supported: false };
  if (!currentConfig.enabled) {
    if (nativeAddon && devicesClaimed) nativeAddon.release();
    devicesClaimed = false;
    return { ok: true };
  }

  const addon = ensureAddon();
  if (!devicesClaimed) {
    cachedScan = addon.scan();
    devicesClaimed = true;
  }
  if (!cachedScan.devices?.length) return { ok: false, error: 'NO_SUPPORTED_DEVICES' };

  if (currentConfig.mode === 'single-color') {
    addon.setAll(currentConfig.color, currentConfig.brightness);
    return { ok: true };
  }

  if (currentConfig.mode === 'per-device') {
    for (const device of cachedScan.devices) {
      const color = currentConfig.deviceColors?.[device.id] || currentConfig.color;
      addon.setDevice(device.id, color, currentConfig.brightness);
    }
    return { ok: true };
  }

  if (currentConfig.mode === 'per-led') {
    for (const device of cachedScan.devices) {
      const configured = currentConfig.deviceLedColors?.[device.id];
      const colors = Array.from({ length: device.lampCount }, (_, index) =>
        configured?.[index] || currentConfig.deviceColors?.[device.id] || currentConfig.color
      );
      addon.setLeds(device.id, colors, currentConfig.brightness);
    }
    return { ok: true };
  }

  if (DYNAMIC_MODES.has(currentConfig.mode)) {
    addon.setAll(currentConfig.color, clamp(currentConfig.brightness) * clamp(currentConfig.baseLevel, 0.02, 0.5));
  }
  return { ok: true };
}

function onAudioFrame(frame, visualConfig) {
  const lighting = currentConfig;
  if (!lighting?.enabled || !DYNAMIC_MODES.has(lighting.mode) || !cachedScan.devices?.length) return;

  const now = Date.now();
  const requestedInterval = 1000 / clamp(lighting.updateRate, 5, 60);
  const hardwareInterval = Math.max(0, ...cachedScan.devices.map((device) => Number(device.minUpdateIntervalMs) || 0));
  const interval = Math.max(requestedInterval, hardwareInterval);
  if (now - animation.lastFrameAt < interval) return;
  animation.lastFrameAt = now;

  const state = updateAnimation(frame, lighting, visualConfig, now);
  const renderConfig = Array.isArray(frame?.backgroundColors) && frame.backgroundColors.length
    ? { ...visualConfig, __lightingBackgroundColors: frame.backgroundColors }
    : visualConfig;
  const bars = Array.isArray(frame?.bars) && frame.bars.length
    ? frame.bars.map((value) => clamp(value))
    : [state.bands.bass, state.bands.mid, state.bands.treble];

  let addon;
  try { addon = ensureAddon(); } catch { return; }

  const totalLamps = cachedScan.devices.reduce((sum, device) => sum + Math.max(1, Number(device.lampCount) || 1), 0);
  let globalIndex = 0;
  for (let deviceIndex = 0; deviceIndex < cachedScan.devices.length; deviceIndex++) {
    const device = cachedScan.devices[deviceIndex];
    const lampCount = Math.max(1, Number(device.lampCount) || 1);
    const colors = [];
    for (let ledIndex = 0; ledIndex < lampCount; ledIndex++) {
      const position = layoutPosition(lighting, deviceIndex, ledIndex, device, globalIndex, totalLamps, cachedScan.devices.length);
      colors.push(renderPixel(lighting.mode, position, bars, lighting, renderConfig, state));
      globalIndex++;
    }
    try {
      if (lampCount > 1) addon.setLeds(device.id, colors, clamp(lighting.brightness));
      else addon.setDevice(device.id, colors[0], clamp(lighting.brightness));
    } catch {}
  }
}

function availability() {
  if (process.platform !== 'win32' || !nativeAddon || !devicesClaimed) {
    return { ok: true, devices: [], availableCount: 0, totalCount: cachedScan.devices?.length || 0 };
  }
  try {
    const states = nativeAddon.availability();
    const byId = new Map(states.map((item) => [item.id, Boolean(item.available)]));
    const devices = (cachedScan.devices || []).map((device) => ({
      ...device,
      available: byId.get(device.id) === true,
    }));
    return {
      ok: true,
      devices,
      availableCount: devices.filter((device) => device.available).length,
      totalCount: devices.length,
    };
  } catch (error) {
    return { ok: false, devices: [], availableCount: 0, totalCount: cachedScan.devices?.length || 0, error: error.message };
  }
}

function hasPackageIdentity() {
  if (process.platform !== 'win32') return false;
  try { return Boolean(ensureAddon().hasPackageIdentity()); }
  catch { return false; }
}

async function stop() {
  if (!nativeAddon) return;
  try { nativeAddon.shutdown(); } catch {}
  nativeAddon = null;
}

module.exports = { scan, setConfig, onAudioFrame, availability, hasPackageIdentity, stop };
