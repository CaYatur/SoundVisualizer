'use strict';

const { app, shell } = require('electron');

const PACKAGE_NAME = 'CAYADEV.SoundVisualizer.Identity';

function isPortable() {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
}

function hasPackageIdentity(dynamicLighting) {
  try {
    return Boolean(dynamicLighting.hasPackageIdentity?.());
  } catch {
    return false;
  }
}

function status(dynamicLighting) {
  const portable = isPortable();
  return {
    portable,
    packaged: app.isPackaged,
    hasIdentity: portable ? false : hasPackageIdentity(dynamicLighting),
    restartExecutableFound: false,
    canInstall: false,
    foregroundOnly: portable,
  };
}

async function openDynamicLightingSettings() {
  await shell.openExternal('ms-settings:personalization-lighting');
  return { ok: true };
}

module.exports = {
  PACKAGE_NAME,
  isPortable,
  status,
  openDynamicLightingSettings,
};
