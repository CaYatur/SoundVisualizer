'use strict';

const fs = require('fs');
const path = require('path');

const STATIC_MODES = new Set(['single-color', 'per-device', 'per-led']);
const DYNAMIC_MODES = new Set([
  'visualizer-sync',
  'spectrum-bars',
  'band-zones',
  'background-sync',
  'beat-pulse',
  'ripple',
  'ambient-fusion',
  'device-flow',
  'rainbow',
  'threshold-background-burst',
]);

let nativeAddon = null;
let cachedScan = { ok: true, supported: process.platform === 'win32', devices: [] };
let currentConfig = null;
let devicesClaimed = false;

const animation = {
  lastFrameAt: 0,
  lastTickAt: 0,
  phase: 0,
  flash: 0,
  previousTrigger: 0,
  lastBeatAt: 0,
  rippleFlip: false,
  ripples: [],
  mode: '',
  smooth: { level: 0, bass: 0, mid: 0, treble: 0 },
  bandEnvelope: { bass: 0, mid: 0, treble: 0 },
  thresholdBurst: 0,
  thresholdPrevious: 0,
  thresholdLastAt: 0,
};

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

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function mod(value, divisor = 1) {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeLighting(config) {
  return {
    enabled: false,
    mode: 'visualizer-sync',
    color: '#ff3366',
    color2: '#33aaff',
    bassColor: '#52ff3f',
    midColor: '#35b8ff',
    trebleColor: '#d43cff',
    brightness: 1,
    intensity: 0.85,
    smoothing: 0.65,
    updateRate: 24,
    layout: 'global',
    paletteSource: 'visualizer',
    colorSpeed: 0.45,
    spread: 1,
    saturation: 1,
    baseLevel: 0.14,
    bassGain: 1.15,
    midGain: 1,
    trebleGain: 1,
    spectrumContrast: 0.82,
    zoneBlend: 0.55,
    flashStrength: 0.85,
    flashThreshold: 0.42,
    flashDecay: 0.82,
    triggerBand: 'bass',
    rippleSpeed: 0.8,
    rippleWidth: 0.16,
    rippleDirection: 'forward',
    fusionMix: 0.55,
    flowSpeed: 0.45,
    audioAcceleration: 0.8,
    bandResponse: 'instant',
    bandAttack: 0.92,
    bandRelease: 0.38,
    bandThreshold: 0.08,
    bandHardness: 0.78,
    bandSeparation: 0.72,
    bandPattern: 'zones',
    rainbowStyle: 'ordered',
    rainbowSpeed: 0.5,
    rainbowAudioBand: 'level',
    rainbowAudioBrightness: 0.85,
    rainbowBaseBrightness: 0.2,
    rainbowSpread: 1.0,
    thresholdBurstSource: 'bass',
    thresholdBurstThreshold: 0.55,
    thresholdBurstMode: 'hybrid',
    thresholdBurstStrength: 1.0,
    thresholdBurstDecay: 0.82,
    thresholdBurstCooldown: 120,
    thresholdBurstBaseBrightness: 0.04,
    thresholdBurstColorPosition: 'source',
    deviceColors: {},
    deviceLedColors: {},
    ...(config || {}),
  };
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

function resetAnimation(mode) {
  animation.lastFrameAt = 0;
  animation.lastTickAt = 0;
  animation.phase = 0;
  animation.flash = 0;
  animation.previousTrigger = 0;
  animation.lastBeatAt = 0;
  animation.ripples = [];
  animation.mode = mode;
  animation.smooth = { level: 0, bass: 0, mid: 0, treble: 0 };
  animation.bandEnvelope = { bass: 0, mid: 0, treble: 0 };
  animation.thresholdBurst = 0;
  animation.thresholdPrevious = 0;
  animation.thresholdLastAt = 0;
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

function parseHex(hex) {
  const raw = String(hex || '#000000').replace('#', '').trim();
  const normalized = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw.padEnd(6, '0').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  return Number.isFinite(value)
    ? [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    : [0, 0, 0];
}

function rgbHex(rgb) {
  return '#' + rgb.map((value) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, '0')).join('');
}

function mixHex(a, b, amount) {
  const left = parseHex(a);
  const right = parseHex(b);
  const t = clamp(amount);
  return rgbHex(left.map((value, index) => value * (1 - t) + right[index] * t));
}

function scaleHex(color, factor) {
  const rgb = parseHex(color);
  return rgbHex(rgb.map((value) => value * Math.max(0, Number(factor) || 0)));
}

function saturateHex(color, saturation) {
  const rgb = parseHex(color);
  const gray = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
  const amount = clamp(saturation, 0, 1.5);
  return rgbHex(rgb.map((value) => gray + (value - gray) * amount));
}

function hslToHex(hue, saturation, lightness) {
  const h = mod(hue, 360) / 360;
  const s = clamp(saturation);
  const l = clamp(lightness);
  if (s === 0) return rgbHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (offset) => {
    let t = mod(h + offset, 1);
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbHex([channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255]);
}

function samplePalette(colors, position) {
  const palette = (Array.isArray(colors) ? colors : []).filter(Boolean);
  if (!palette.length) return '#000000';
  if (palette.length === 1) return palette[0];
  const p = mod(position, 1);
  const scaled = p * palette.length;
  const index = Math.floor(scaled) % palette.length;
  return mixHex(palette[index], palette[(index + 1) % palette.length], scaled - Math.floor(scaled));
}

function sampleLinearPalette(colors, position) {
  const palette = (Array.isArray(colors) ? colors : []).filter(Boolean);
  if (!palette.length) return '#000000';
  if (palette.length === 1) return palette[0];
  const p = clamp(position);
  const scaled = p * (palette.length - 1);
  const index = Math.floor(scaled);
  return mixHex(palette[index], palette[Math.min(palette.length - 1, index + 1)], scaled - index);
}

function backgroundPalette(visualConfig) {
  const sampled = visualConfig?.__lightingBackgroundColors;
  if (Array.isArray(sampled) && sampled.length) return sampled;
  if (visualConfig?.background?.type === 'solid') {
    return [visualConfig.background.solidColor || '#08080f'];
  }
  const colors = visualConfig?.background?.gradient?.colors;
  return Array.isArray(colors) && colors.length ? colors : ['#5b4be0', '#3aa6ff', '#37e0c8', '#7be07b', '#d24bff'];
}

function sourceColor(source, position, value, time, lighting, visualConfig) {
  const saturation = clamp(lighting.saturation, 0, 1.5);
  if (source === 'visualizer') {
    const visualizer = visualConfig?.visualizer || {};
    if (visualizer.rainbow) {
      return hslToHex(position * 320 + time * 12, clamp(0.85 * saturation), clamp(0.55 + value * 0.12, 0.12, 0.8));
    }
    return saturateHex(mixHex(visualizer.color || lighting.color, visualizer.color2 || lighting.color2, mod(position, 1)), saturation);
  }
  if (source === 'background') {
    const sampled = Array.isArray(visualConfig?.__lightingBackgroundColors)
      && visualConfig.__lightingBackgroundColors.length > 0;
    const color = sampled
      ? sampleLinearPalette(backgroundPalette(visualConfig), position)
      : samplePalette(backgroundPalette(visualConfig), position);
    return saturateHex(color, saturation);
  }
  if (source === 'bands') {
    return saturateHex(samplePalette([lighting.bassColor, lighting.midColor, lighting.trebleColor], position), saturation);
  }
  if (source === 'rainbow') {
    return hslToHex(position * 360 + time * 24, clamp(0.9 * saturation), clamp(0.52 + value * 0.14, 0.15, 0.82));
  }
  return saturateHex(samplePalette([lighting.color, lighting.color2], position), saturation);
}

function sampleArray(values, position) {
  if (!Array.isArray(values) || !values.length) return 0;
  if (values.length === 1) return clamp(values[0]);
  const p = clamp(position);
  const scaled = p * (values.length - 1);
  const index = Math.floor(scaled);
  return clamp((Number(values[index]) || 0) * (1 - (scaled - index)) + (Number(values[Math.min(values.length - 1, index + 1)]) || 0) * (scaled - index));
}

function gainForPosition(position, lighting) {
  if (position < 1 / 3) return clamp(lighting.bassGain, 0, 3);
  if (position < 2 / 3) return clamp(lighting.midGain, 0, 3);
  return clamp(lighting.trebleGain, 0, 3);
}

function triggerValue(triggerBand, bands) {
  if (triggerBand === 'mid') return bands.mid;
  if (triggerBand === 'treble') return bands.treble;
  if (triggerBand === 'level') return bands.level;
  if (triggerBand === 'auto') return Math.max(bands.bass, bands.mid * 0.95, bands.treble * 0.9);
  return bands.bass;
}

function shapeBand(value, threshold, hardness) {
  const normalized = clamp((value - threshold) / Math.max(0.001, 1 - threshold));
  const exponent = 2.4 - clamp(hardness) * 2.1;
  return clamp(Math.pow(normalized, Math.max(0.18, exponent)));
}

function updateBandEnvelope(key, target, lighting) {
  const profile = lighting.bandResponse || 'instant';
  if (profile === 'instant') {
    animation.bandEnvelope[key] = target;
    return target;
  }
  const attack = profile === 'punchy' ? clamp(lighting.bandAttack, 0.55, 1) : clamp(lighting.bandAttack, 0.15, 1);
  const release = profile === 'punchy' ? clamp(lighting.bandRelease, 0.08, 0.65) : clamp(lighting.bandRelease, 0.03, 0.45);
  const previous = animation.bandEnvelope[key] || 0;
  const amount = target >= previous ? attack : release;
  const next = previous + (target - previous) * amount;
  animation.bandEnvelope[key] = next;
  return next;
}

function separatedBands(raw, lighting) {
  const threshold = clamp(lighting.bandThreshold, 0, 0.8);
  const hardness = clamp(lighting.bandHardness);
  const separation = clamp(lighting.bandSeparation);
  const bassRaw = shapeBand(raw.bass * clamp(lighting.bassGain, 0, 3), threshold, hardness);
  const midRaw = shapeBand(raw.mid * clamp(lighting.midGain, 0, 3), threshold, hardness);
  const trebleRaw = shapeBand(raw.treble * clamp(lighting.trebleGain, 0, 3), threshold, hardness);
  const bass = clamp(bassRaw - Math.max(midRaw, trebleRaw) * separation * 0.38);
  const mid = clamp(midRaw - Math.max(bassRaw, trebleRaw) * separation * 0.28);
  const treble = clamp(trebleRaw - Math.max(bassRaw, midRaw) * separation * 0.34);
  return {
    bass: updateBandEnvelope('bass', bass, lighting),
    mid: updateBandEnvelope('mid', mid, lighting),
    treble: updateBandEnvelope('treble', treble, lighting),
  };
}

function dominantPosition(bands) {
  const weighted = [bands.bass * 1.08, bands.mid, bands.treble * 0.96];
  const index = weighted.indexOf(Math.max(...weighted));
  return [0.08, 0.5, 0.9][index];
}

function updateAnimation(frame, lighting, visualConfig, now) {
  const dt = animation.lastTickAt ? clamp((now - animation.lastTickAt) / 1000, 0.001, 0.15) : 1 / 24;
  animation.lastTickAt = now;
  const smoothing = clamp(lighting.smoothing, 0, 0.96);
  for (const key of ['level', 'bass', 'mid', 'treble']) {
    const target = clamp(frame?.[key]);
    animation.smooth[key] = animation.smooth[key] * smoothing + target * (1 - smoothing);
  }

  const rawBands = {
    level: clamp(frame?.level),
    bass: clamp(frame?.bass),
    mid: clamp(frame?.mid),
    treble: clamp(frame?.treble),
  };
  const profile = lighting.bandResponse || 'instant';
  const bandInput = profile === 'smooth' ? animation.smooth : rawBands;
  const separated = separatedBands(bandInput, lighting);
  const bands = {
    level: profile === 'instant' ? rawBands.level : animation.smooth.level,
    bass: separated.bass,
    mid: separated.mid,
    treble: separated.treble,
  };

  let thresholdInput = 0;
  let thresholdExcess = 0;
  if (lighting.mode === 'threshold-background-burst') {
    thresholdInput = triggerValue(lighting.thresholdBurstSource || 'bass', rawBands);
    const threshold = clamp(lighting.thresholdBurstThreshold, 0.01, 0.99);
    thresholdExcess = clamp((thresholdInput - threshold) / Math.max(0.01, 1 - threshold));
    const decay = clamp(lighting.thresholdBurstDecay, 0.45, 0.995);
    animation.thresholdBurst *= Math.pow(decay, dt * 30);

    const burstMode = lighting.thresholdBurstMode || 'hybrid';
    const crossed = thresholdInput >= threshold && animation.thresholdPrevious < threshold;
    const sharpRise = thresholdInput >= threshold && thresholdInput - animation.thresholdPrevious > 0.035;
    const cooldown = clamp(lighting.thresholdBurstCooldown, 0, 1000);
    if ((burstMode === 'pulse' || burstMode === 'hybrid')
      && (crossed || sharpRise)
      && now - animation.thresholdLastAt >= cooldown) {
      animation.thresholdBurst = Math.max(animation.thresholdBurst, Math.max(0.18, thresholdExcess));
      animation.thresholdLastAt = now;
    }
    if (burstMode === 'proportional') animation.thresholdBurst = thresholdExcess;
    else if (burstMode === 'hybrid') animation.thresholdBurst = Math.max(animation.thresholdBurst, thresholdExcess);
    animation.thresholdPrevious = thresholdInput;
  }

  const gradient = visualConfig?.background?.gradient || {};
  let speed = clamp(lighting.colorSpeed, 0, 3);
  if (lighting.mode === 'background-sync') {
    speed = clamp(gradient.speed ?? lighting.colorSpeed, 0, 3)
      * (1 + bands.bass * clamp(gradient.audioReactivity, 0, 2) * 2.4 + bands.level * clamp(gradient.audioReactivity, 0, 2) * 0.9);
  } else if (lighting.mode === 'device-flow') {
    speed = clamp(lighting.flowSpeed, 0, 3) * (1 + bands.level * clamp(lighting.audioAcceleration, 0, 3));
  } else {
    speed *= 1 + bands.level * clamp(lighting.audioAcceleration, 0, 3) * 0.45;
  }
  animation.phase = mod(animation.phase + dt * speed, 1);

  animation.flash *= Math.pow(clamp(lighting.flashDecay, 0.45, 0.995), dt * 30);
  const trigger = triggerValue(lighting.triggerBand, bands);
  const rise = trigger - animation.previousTrigger;
  const threshold = clamp(lighting.flashThreshold, 0.02, 0.98);
  const hit = trigger >= threshold && rise > 0.02 && now - animation.lastBeatAt > 110;
  if (hit) {
    const normalized = clamp((trigger - threshold) / Math.max(0.02, 1 - threshold) + rise * 1.8);
    animation.flash = Math.max(animation.flash, normalized * clamp(lighting.flashStrength, 0, 1.5));
    animation.lastBeatAt = now;
    if (lighting.mode === 'ripple') {
      let direction = lighting.rippleDirection || 'forward';
      if (direction === 'alternate') {
        animation.rippleFlip = !animation.rippleFlip;
        direction = animation.rippleFlip ? 'forward' : 'reverse';
      }
      animation.ripples.push({
        position: direction === 'reverse' ? 1 : 0,
        direction: direction === 'reverse' ? -1 : 1,
        strength: Math.max(0.45, normalized),
        colorPosition: dominantPosition(bands),
      });
      if (animation.ripples.length > 6) animation.ripples.shift();
    }
  }
  animation.previousTrigger = trigger;

  if (lighting.mode === 'ripple' && animation.ripples.length) {
    const velocity = clamp(lighting.rippleSpeed, 0.05, 3);
    for (const ripple of animation.ripples) {
      ripple.position += ripple.direction * velocity * dt;
      ripple.strength *= Math.pow(0.985, dt * 30);
    }
    animation.ripples = animation.ripples.filter((ripple) => ripple.position > -0.35 && ripple.position < 1.35 && ripple.strength > 0.03);
  }

  return {
    dt,
    bands,
    rawBands,
    hit,
    thresholdInput,
    thresholdExcess,
    thresholdBurst: animation.thresholdBurst,
    time: Number(frame?.time) || now / 1000,
  };
}

function layoutPosition(lighting, deviceIndex, ledIndex, device, globalIndex, totalLamps, deviceCount) {
  if (lighting.layout === 'uniform') return 0.5;
  if (lighting.layout === 'per-device') {
    if (device.lampCount <= 1) return deviceCount <= 1 ? 0.5 : deviceIndex / (deviceCount - 1);
    return ledIndex / Math.max(1, device.lampCount - 1);
  }
  return totalLamps <= 1 ? 0.5 : globalIndex / (totalLamps - 1);
}

function renderPixel(mode, position, bars, lighting, visualConfig, state) {
  const { bands, time } = state;
  const baseLevel = clamp(lighting.baseLevel, 0, 0.75);
  const energy = clamp(bands.level * 0.45 + bands.bass * 0.3 + bands.mid * 0.15 + bands.treble * 0.1);
  const spreadPosition = position * clamp(lighting.spread, 0.1, 4);

  if (mode === 'visualizer-sync') {
    const value = clamp(bands.mid * (1 - position) + bands.treble * position + bands.bass * 0.2);
    const color = sourceColor('visualizer', spreadPosition + animation.phase * 0.12, value, time, lighting, visualConfig);
    return scaleHex(color, baseLevel + value * clamp(lighting.intensity) * (1 - baseLevel));
  }

  if (mode === 'spectrum-bars') {
    const raw = sampleArray(bars, position);
    const contrast = clamp(lighting.spectrumContrast);
    const value = clamp(Math.pow(raw * gainForPosition(position, lighting), 1.65 - contrast * 1.25));
    const color = sourceColor(lighting.paletteSource, spreadPosition + animation.phase * 0.08, value, time, lighting, visualConfig);
    return scaleHex(color, baseLevel + value * clamp(lighting.intensity) * (1 - baseLevel));
  }

  if (mode === 'band-zones') {
    const pattern = lighting.bandPattern || 'zones';
    let bandIndex;
    if (pattern === 'alternate') bandIndex = Math.floor(position * 12) % 3;
    else if (pattern === 'mirror') bandIndex = Math.min(2, Math.floor(Math.abs(position - 0.5) * 6));
    else if (pattern === 'dominant') {
      const values = [bands.bass, bands.mid, bands.treble];
      bandIndex = values.indexOf(Math.max(...values));
    } else bandIndex = position < 1 / 3 ? 0 : position < 2 / 3 ? 1 : 2;
    const values = [bands.bass, bands.mid, bands.treble];
    const positions = [0, 0.5, 1];
    const value = values[bandIndex];
    const blend = clamp(lighting.zoneBlend);
    const colorPosition = positions[bandIndex] * (1 - blend) + position * blend;
    const color = sourceColor('bands', colorPosition, value, time, lighting, visualConfig);
    return scaleHex(color, baseLevel + clamp(value) * clamp(lighting.intensity) * (1 - baseLevel));
  }

  if (mode === 'rainbow') {
    const audio = triggerValue(lighting.rainbowAudioBand || 'level', bands);
    const ordered = lighting.rainbowStyle !== 'single';
    const huePosition = ordered ? position * clamp(lighting.rainbowSpread, 0.1, 4) : 0;
    const hue = (animation.phase * 360 * clamp(lighting.rainbowSpeed, 0.05, 3)) + huePosition * 360;
    const color = hslToHex(hue, clamp(0.92 * lighting.saturation, 0, 1), 0.55);
    const brightness = clamp(lighting.rainbowBaseBrightness, 0.02, 1)
      + clamp(audio) * clamp(lighting.rainbowAudioBrightness, 0, 1.5);
    return scaleHex(color, clamp(brightness));
  }

  if (mode === 'threshold-background-burst') {
    const sampled = Array.isArray(visualConfig?.__lightingBackgroundColors)
      && visualConfig.__lightingBackgroundColors.length > 0;
    const source = lighting.thresholdBurstSource || 'bass';
    const sourcePosition = source === 'bass'
      ? 0.12
      : source === 'mid'
        ? 0.5
        : source === 'treble'
          ? 0.88
          : source === 'auto'
            ? dominantPosition(state.rawBands || bands)
            : 0.5;
    const colorMode = lighting.thresholdBurstColorPosition || 'source';
    const colorPosition = colorMode === 'spread'
      ? clamp(position)
      : colorMode === 'center'
        ? 0.5
        : sourcePosition;
    const samplePosition = sampled ? colorPosition : colorPosition + animation.phase;
    const backgroundColor = sourceColor('background', samplePosition, state.thresholdInput, time, lighting, visualConfig);
    const burst = clamp(state.thresholdBurst * clamp(lighting.thresholdBurstStrength, 0, 2));
    const flashColor = mixHex(backgroundColor, '#ffffff', clamp(burst * 0.28));
    const brightness = clamp(lighting.thresholdBurstBaseBrightness, 0, 1) + burst;
    return scaleHex(flashColor, clamp(brightness));
  }

  if (mode === 'background-sync') {
    const sampled = Array.isArray(visualConfig?.__lightingBackgroundColors)
      && visualConfig.__lightingBackgroundColors.length > 0;
    const samplePosition = sampled ? clamp(position) : spreadPosition + animation.phase;
    const color = sourceColor('background', samplePosition, energy, time, lighting, visualConfig);
    const reactive = baseLevel + energy * clamp(lighting.intensity) * (1 - baseLevel);
    return scaleHex(color, reactive * (1 + animation.flash * clamp(lighting.flashStrength, 0, 1.5)));
  }

  if (mode === 'beat-pulse') {
    const trigger = triggerValue(lighting.triggerBand, bands);
    const tonePosition = dominantPosition(bands);
    const ambient = sourceColor(lighting.paletteSource, spreadPosition + animation.phase * 0.2, trigger, time, lighting, visualConfig);
    const tone = sourceColor(lighting.paletteSource, tonePosition + animation.phase * 0.08, trigger, time, lighting, visualConfig);
    const color = mixHex(ambient, tone, clamp(animation.flash * 1.4));
    return scaleHex(color, baseLevel + clamp(animation.flash + trigger * 0.14) * (1 - baseLevel));
  }

  if (mode === 'ripple') {
    let color = scaleHex(sourceColor(lighting.paletteSource, spreadPosition + animation.phase * 0.25, energy, time, lighting, visualConfig), baseLevel);
    let peak = baseLevel;
    const width = clamp(lighting.rippleWidth, 0.03, 0.6);
    for (const ripple of animation.ripples) {
      const distance = position - ripple.position;
      const strength = Math.exp(-(distance * distance) / (2 * width * width)) * ripple.strength;
      if (strength <= 0.01) continue;
      const rippleColor = sourceColor(lighting.paletteSource, ripple.colorPosition + animation.phase * 0.08, strength, time, lighting, visualConfig);
      color = mixHex(color, rippleColor, clamp(strength));
      peak = Math.max(peak, strength);
    }
    return scaleHex(color, Math.max(baseLevel, peak));
  }

  if (mode === 'ambient-fusion') {
    const bar = sampleArray(bars, position);
    const sampled = Array.isArray(visualConfig?.__lightingBackgroundColors)
      && visualConfig.__lightingBackgroundColors.length > 0;
    const visualizerColor = sourceColor('visualizer', spreadPosition + animation.phase * 0.08, bar, time, lighting, visualConfig);
    const backgroundColor = sourceColor('background', sampled ? clamp(position) : spreadPosition + animation.phase, energy, time, lighting, visualConfig);
    const color = mixHex(visualizerColor, backgroundColor, clamp(lighting.fusionMix));
    const factor = baseLevel + clamp(bar * 0.72 + energy * 0.28) * clamp(lighting.intensity) * (1 - baseLevel);
    return scaleHex(color, factor * (1 + animation.flash * clamp(lighting.flashStrength, 0, 1.5) * 0.7));
  }

  if (mode === 'device-flow') {
    const color = sourceColor(lighting.paletteSource, spreadPosition + animation.phase, energy, time, lighting, visualConfig);
    const factor = baseLevel + clamp(0.32 + energy * clamp(lighting.intensity) * 0.68) * (1 - baseLevel);
    return scaleHex(color, factor * (1 + animation.flash * clamp(lighting.flashStrength, 0, 1.5) * 0.35));
  }

  return lighting.color;
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
