/* Windows araması ve yükseltmede kısayol kimliğini koruyan sözleşme testleri. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const build = pkg.build;
const nsh = read('scripts/windows-shortcuts.nsh');
const macro = (name) => {
  const match = nsh.match(new RegExp('!macro ' + name + '\\r?\\n([\\s\\S]*?)!macroend'));
  assert.ok(match, name);
  return match[1];
};

test('Windows main shortcut uses the approved display name without renaming the product', () => {
  assert.equal(build.nsis.shortcutName, 'CaYaDev SoundVisualizer');
  assert.equal(pkg.name, 'soundvisualizer');
  assert.equal(build.productName, 'CAYADEV Visualizer');
  assert.equal(build.win.executableName, undefined);
  assert.equal(build.nsis.menuCategory, undefined);
});

test('main shortcut identity stays aligned with the running app and sparse package', () => {
  assert.equal(build.appId, 'com.cayadev.visualizer');
  assert.ok(read('src/main/main.js').includes("app.setAppUserModelId('" + build.appId + "')"));
  assert.match(read('scripts/prepare-identity.js'), /Executable="CAYADEV Visualizer\.exe"/);
  const install = macro('svInstallWindowsShortcuts');
  for (const link of ['$newStartMenuLink', '$newDesktopLink']) {
    assert.ok(install.includes('WinShell::SetLnkAUMI "' + link + '" "${APP_ID}"'));
  }
  assert.doesNotMatch(nsh, /UninstAppUserModelId|User Pinned|TaskBar/);
});

test('old search name is stored in existing main shortcut comments, never as a duplicate alias', () => {
  assert.match(nsh, /!define SV_MAIN_SHORTCUT_DESCRIPTION "CaYaDev Visualizer \| CaYaDev SoundVisualizer"/);
  const install = macro('svInstallWindowsShortcuts');
  for (const link of ['$newStartMenuLink', '$newDesktopLink']) {
    const at = install.indexOf('CreateShortCut "' + link + '"');
    assert.ok(at > 0);
    assert.ok(install.slice(0, at).includes('${If} ${FileExists} "' + link + '"'));
    assert.ok(install.slice(at).split(/\r?\n/)[0].endsWith('"${SV_MAIN_SHORTCUT_DESCRIPTION}"'));
  }
  assert.doesNotMatch(install, /CreateShortCut "\$SMPROGRAMS\\CAYADEV Visualizer\.lnk"/);
});

test('bridge name, folder and comment do not advertise Visualizer search tokens', () => {
  const defs = Object.fromEntries([...nsh.matchAll(/^!define (SV_\w+) "([^"]+)"$/gm)].map((m) => [m[1], m[2]]));
  assert.equal(defs.SV_BRIDGE_SHORTCUT, 'CaYaDev Audio Bridge');
  assert.equal(defs.SV_BRIDGE_MENU_FOLDER, 'CaYaDev Audio Tools');
  assert.doesNotMatch(defs.SV_BRIDGE_SHORTCUT + defs.SV_BRIDGE_MENU_FOLDER, /visualizer/i);
  const install = macro('svInstallWindowsShortcuts');
  assert.match(install, /CreateDirectory "\$SMPROGRAMS\\\$\{SV_BRIDGE_MENU_FOLDER\}"/);
  assert.match(install, /CreateShortCut "\$SMPROGRAMS\\\$\{SV_BRIDGE_MENU_FOLDER\}\\\$\{SV_BRIDGE_SHORTCUT\}\.lnk" "\$INSTDIR\\\$\{APP_EXECUTABLE_FILENAME\}" "--bridge"/);
  assert.match(install, /!ifndef DO_NOT_CREATE_START_MENU_SHORTCUT[\s\S]*CreateDirectory/);
});

test('update and uninstall remove only known legacy links in the selected install scopes', () => {
  const cleanup = macro('svCleanupLegacyWindowsShortcuts');
  const deletes = [...cleanup.matchAll(/^  Delete "([^"]+)"$/gm)].map((m) => m[1]);
  assert.deepEqual(deletes, [
    '$SMPROGRAMS\\CAYADEV Visualizer Audio Bridge.lnk',
    '$SMPROGRAMS\\CAYADEV Visualizer.lnk',
    '$DESKTOP\\CAYADEV Visualizer.lnk',
  ]);
  const scopes = macro('svCleanupLegacyWindowsShortcutScopes');
  assert.match(scopes, /\$installMode == "all"[\s\S]*SetShellVarContext current[\s\S]*!insertmacro svCleanupLegacyWindowsShortcuts[\s\S]*SetShellVarContext all/);
  for (const name of ['svInstallWindowsShortcuts', 'svRemoveWindowsShortcuts']) {
    assert.match(macro(name), /!insertmacro svCleanupLegacyWindowsShortcutScopes/);
  }
  const uninstall = macro('svRemoveWindowsShortcuts');
  assert.match(uninstall, /Delete "\$SMPROGRAMS\\\$\{SV_BRIDGE_MENU_FOLDER\}\\\$\{SV_BRIDGE_SHORTCUT\}\.lnk"/);
  assert.match(uninstall, /^  RMDir "\$SMPROGRAMS\\\$\{SV_BRIDGE_MENU_FOLDER\}"$/m);
  assert.doesNotMatch(uninstall, /Delete "\$new|RMDir \/r/);
});

test('shortcut migration is wired into ordinary and silent NSIS installs without changing update assets', () => {
  const include = read('scripts/installer.nsh');
  assert.match(include, /!include "\$\{PROJECT_DIR\}\\scripts\\windows-shortcuts\.nsh"/);
  assert.match(include, /!macro customInstall[\s\S]*!insertmacro svInstallWindowsShortcuts/);
  assert.match(include, /!macro customUnInstall[\s\S]*!insertmacro svRemoveWindowsShortcuts/);
  assert.doesNotMatch(macro('svInstallWindowsShortcuts'), /\$\{Silent\}|\$\{isUpdated\}/);
  assert.equal(build.nsis.artifactName, 'CAYADEV-Visualizer-${version}-windows-setup.exe');
  assert.equal(build.portable.artifactName, 'CAYADEV-Visualizer-${version}-windows-portable.exe');
  assert.match(read('scripts/release-assets.js'), /CAYADEV-Visualizer-' \+ version \+ '-windows-setup\.exe/);
});

test('Linux display name and keywords preserve launcher identity, installation path and bridge action', async (t) => {
  assert.equal(build.linux.desktop.entry.Name, 'CaYaDev SoundVisualizer');
  assert.equal(build.linux.desktop.entry.Keywords, 'Visualizer;SoundVisualizer;CaYaDev;');
  assert.equal(build.linux.executableName, undefined);
  assert.equal(build.linux.syncDesktopName, undefined);
  assert.equal(build.deb.desktop.desktopActions.bridge.Exec, '"/opt/CAYADEV Visualizer/soundvisualizer" --bridge');
  let LinuxTargetHelper, deepAssign;
  try {
    ({ LinuxTargetHelper } = require('app-builder-lib/out/targets/LinuxTargetHelper'));
    ({ deepAssign } = require('builder-util-runtime'));
  } catch {
    t.diagnostic('electron-builder not installed; generated desktop entry checks require packaging dependencies');
    return;
  }
  const helper = Object.create(LinuxTargetHelper.prototype);
  helper.packager = {
    platformSpecificBuildOptions: build.linux,
    info: { metadata: pkg },
    config: build,
    executableName: 'soundvisualizer',
    appInfo: { productName: build.productName, sanitizedProductName: build.productName, description: pkg.description },
    fileAssociations: [],
  };
  for (const options of [build.linux, deepAssign({}, build.linux, build.deb)]) {
    const desktop = await helper.computeDesktopEntry(options);
    assert.match(desktop, /^Name=CaYaDev SoundVisualizer$/m);
    assert.match(desktop, /^Keywords=Visualizer;SoundVisualizer;CaYaDev;$/m);
    assert.match(desktop, /^Exec="\/opt\/CAYADEV Visualizer\/soundvisualizer" %U$/m);
    assert.match(desktop, /^StartupWMClass=CAYADEV Visualizer$/m);
  }
});

test('macOS changes only the display label, not the bundle or executable name', () => {
  assert.equal(build.mac.extendInfo.CFBundleDisplayName, 'CaYaDev SoundVisualizer');
  for (const key of ['CFBundleIdentifier', 'CFBundleExecutable', 'CFBundleName']) {
    assert.equal(build.mac.extendInfo[key], undefined);
  }
  assert.equal(build.mac.artifactName, 'CAYADEV-Visualizer-${version}-macos-${arch}.${ext}');
  assert.equal(build.dmg.title, 'CAYADEV Visualizer');
});
