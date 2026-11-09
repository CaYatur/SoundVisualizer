# Installed application names and Windows search

The main launcher is **CaYaDev SoundVisualizer**. On Windows the bridge is
**CaYaDev Audio Bridge**, under **CaYaDev Audio Tools**. The bridge folder deliberately
contains neither `Visualizer` nor `SoundVisualizer`, so it does not add those words
to the bridge shortcut's indexed path. This reduces ambiguity; Windows controls
search ranking and can also inspect the shared executable.

## Search terms and limits

- `cayadev soundvisualizer` and `soundvisualizer` appear in the main shortcut's name.
- `cayadev visualizer` is retained in the main shortcut's comment/description
  (`CaYaDev Visualizer | CaYaDev SoundVisualizer`) and in the unchanged executable
  name (`CAYADEV Visualizer.exe`). The installer refreshes the comments of existing
  main Start-menu and desktop links, including links renamed during silent updates.
- This is **not a guarantee** of a particular Windows Search result or Best Match.
  Windows versions, indexing settings, caches and prior launches affect results.
  AppUserModelID is an identity/grouping mechanism, not a search-keyword API.
  No duplicate alias shortcuts or registry keyword hacks are installed.

Microsoft documents that Start-menu folders are indexed and file properties can
be indexed: [What is included in the index](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/legacy/bb266513(v=vs.85))
and [Windows Search configuration](https://devblogs.microsoft.com/windows-search-platform/configuration-and-settings/).
A [Windows 11 shortcut experiment](https://stackoverflow.com/questions/75214010/adding-additional-windows-search-keywords-to-a-single-shortcut-or-executable)
reports matching shortcut comments and target names; this is observed behavior,
not a documented cross-version Start-search contract.

## Identity and upgrade safety

`com.cayadev.visualizer`, `build.productName`, executable names, package names,
installation directories, user-data names, Dynamic Lighting identity and release
asset filenames stay unchanged. The main shortcut still uses the same
AppUserModelID as `app.setAppUserModelId`, in accordance with
[Microsoft's AppUserModelID guidance](https://learn.microsoft.com/en-us/windows/win32/shell/appids).
Pinned shortcut files are not edited by the custom migration.

Electron-builder first creates/renames the main shortcut using its stored
`ShortcutName`, `MenuDirectory` and keep-shortcuts logic. The custom install hook
then refreshes existing main shortcut comments/AUMID and removes known legacy
`CAYADEV Visualizer.lnk` (Start menu and desktop) and
`CAYADEV Visualizer Audio Bridge.lnk` (Start menu). It creates the newly named
bridge under the audio-tools folder. The hook is not conditional on interactive
or silent `--updated` mode. A deliberately deleted main shortcut is not recreated
by this hook.

Cleanup runs in the selected install scope. An all-users install additionally
cleans the elevated process's current-user legacy links, then restores all-users
scope. Other users' profiles and unrelated shortcuts are not scanned or deleted.
Uninstall removes the new bridge and legacy links; the tools folder is removed
only when empty. Electron-builder owns removal of the new main shortcut, preserving
its `--keep-shortcuts` behavior during later updates. The bridge's separate
optional **Startup** shortcut/autostart configuration is intentionally unchanged.

Linux overrides only desktop `Name` and `Keywords` (`Visualizer;SoundVisualizer;CaYaDev;`),
including `.deb`'s existing bridge desktop action. Executable paths, desktop-file
identity, icon name and StartupWMClass remain unchanged. macOS overrides only
`CFBundleDisplayName`; bundle ID/name, `.app` directory, executable and DMG/update
asset names remain unchanged.

## Manual acceptance on real machines

CI source/contract tests do **not** prove Start-menu search or installer execution.
Before release, on Windows 10 and 11:

1. Install the old version, pin/launch the main app, then update both interactively
   and through the silent auto-update path. Repeat per-user and all-users installs.
2. Check Programs and Desktop for duplicates; verify the new bridge path and
   `--bridge` target. Uninstall and ensure no generated links remain. Files added
   manually to the tools folder must survive.
3. Once indexing settles, search all three phrases and launch the main app from
   each result. Check pinned launch, taskbar grouping and notifications.
4. Confirm the chosen display label in Linux launchers and macOS Finder/Spotlight;
   confirm existing settings and update detection survive.
