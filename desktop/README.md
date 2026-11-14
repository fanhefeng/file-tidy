# File Tidy Desktop

Electron 45, React 19.3, TypeScript 7, Vite 8, and electron-vite 6. Exact resolved versions live in `package-lock.json`.

## Develop and verify

From the repository root:

```sh
pnpm install
npm --prefix desktop ci
pnpm desktop:dev
pnpm desktop:test
pnpm desktop:smoke
```

The workspace keeps folder setup on the left and the file preview on the right, with scan and execution controls always available. Use Organize to select a source and destination, preview every move, then organize. Organize in place creates category folders inside the source. Rules shows each file category, including custom categories and unmatched files. Each category has date grouping and editable, ordered subfolder rules; Audio also has metadata grouping presets. File type overrides have a separate entry. Open Edit JSON for advanced settings; it shares the visual editor's draft and saves the same configuration used by the CLI and Raycast. Activity shows this session's operations and reads the latest persisted undo record for the selected destination, including records created by the other adapters.

The native folder picker can create a destination. Typed paths must already exist. If a source file, duplicate keeper, selected root, or configuration changes during analysis or after preview, generate a new preview. Every target is checked through symbolic links before any files move. Partial filesystem failures preserve a run record; use Activity to undo completed moves.

Activity distinguishes a record that could not be read from an empty history and offers a retry. Partial undo lists each affected file, its original and archived locations, and why it could not move; retry requires confirmation of the same saved run. Similar-file details show peers and the heuristic behind the grouping. After organizing, Activity offers the generated report through a restricted local-file action.

## Languages

Use the titlebar's 中文 / EN controls to switch between Simplified Chinese and English. The first launch follows the system language; the saved choice takes precedence afterward. UI language is saved atomically in `preferences.json` inside Electron's user data folder, separately from classification rules. Menus, folder dialogs, progress, validation, errors, and run feedback use the selected language.

Switching language preserves folder inputs, the current preview, filters, and unsaved JSON. File names, real paths, JSON keys, and custom category values stay unchanged. Built-in category names are translated only as display labels. CLI and Raycast keep their existing English interface.

## Configuration

Default file: `~/.config/tidy/config.json` (or `$XDG_CONFIG_HOME/tidy/config.json`), and `%APPDATA%\tidy\config.json` on Windows. Defaults apply to omitted keys. `categories` and `subCategories` replace their whole default maps for compatibility; prefer `extensions` for additions. The root `examples/config.json` contains a minimal example.

## Build and package

```sh
npm --prefix desktop run build
npm --prefix desktop run start
npm --prefix desktop run package:dir
npm --prefix desktop run test:smoke -- --packaged
pnpm desktop:package
```

Build output is in `desktop/out`; packages are in `desktop/release`. electron-builder targets DMG/ZIP on macOS, NSIS on Windows, and AppImage/DEB on Linux. Run distribution builds on each target platform. macOS preview builds use an ad-hoc resource signature (`mac.identity: "-"`) for bundle integrity. This is not an Apple Developer ID signature or notarization: downloaded previews may be blocked by macOS and are not a frictionless public release. Developer ID signing and notarization require the distributor's credentials and a release-specific configuration. Do not disable system security to test a preview.

`test:smoke` launches Electron with an isolated temporary rules directory and `--user-data-dir`, then drives the real renderer through Chromium DevTools. `--packaged` launches the unpacked executable produced by electron-builder. It verifies preview, similarity details, execution, partial undo and retry, corrupt-history recovery, language persistence, keyboard controls, and responsive layouts. Screenshots and diagnostic logs are saved under `release/smoke`; use `--output /absolute/path` to choose another artifact directory. The fixture and test application are cleaned up after the run. On headless Linux CI, run it under `xvfb-run`; the optional `--no-sandbox` is restricted to Linux CI testing.

CI defines these package checks on macOS, Windows, and Linux. A local run verifies only its host platform; CI configuration alone is not evidence that another platform has passed. Native OS folder-dialog behavior and release signing remain part of the target-platform distribution check.

## Architecture

- `src/renderer`: React UI, with no Node or filesystem access.
- `src/preload`: typed, allowlisted bridge; listeners clean up on unmount.
- `src/main/index.ts`: native dialogs, isolated window, single-instance lock, IPC sender checks.
- `src/main/worker.ts`: background operations and short-lived preview ownership, calling the repository's `src/core/index.js`.

A preview ID references the plan in the worker; the renderer cannot provide its own file move list. The worker passes the shared core snapshot into execution, checking source and keeper identity/size/mtime/ctime, loaded rule bytes, selected roots, and canonical path containment before moving. Report actions use worker-owned references instead of renderer-provided paths or URLs. Core manifests remain the authority for undo. No HTTP server or hosted backend is required.

## macOS icon assets

The macOS Dock and bundle use a dedicated transparent icon rather than the opaque square used inside the interface. `resources/icon-macos.png` is the 1024px source; `resources/icon.icns` includes small and Retina representations. On macOS, run `npm run icon:macos` after updating the source. A guarded runtime `app.dock.setIcon` call uses the same PNG in development and packaged builds. It updates the running app without changing system Dock settings.
