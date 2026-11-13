# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Electron wraps this local desktop interface on macOS, Windows, and Linux. Native window controls, dialogs, and menus retain platform behavior.

## Users

People organizing local folders through a shared classification engine with desktop, CLI, and Raycast adapters. The user confirmed that the desktop home should prioritize choosing a folder and seeing its classification preview on the same screen.

## Product Purpose

Turn a collection of local files into a reviewable organization plan, execute that plan, and restore the original locations when needed.

## Operating Context

Users choose source and destination folders, optionally organize in place or recurse into subfolders, inspect archive/duplicate/review destinations, then run the plan. They configure date grouping and ordered subfolder rules by file category, with audio metadata grouping inside Audio and a separate file type override form. An optional JSON editor shares the same draft and configuration. Activity exposes the most recent saved run and session operations.

## Capabilities and Constraints

- Keep the existing core analysis, deduplication, file health checks, audio metadata routing, execution safeguards, and undo manifests.
- The desktop interface supports Simplified Chinese and English, with persisted language selection and localized operational feedback. CLI and Raycast remain English.
- Filenames, destination paths, custom category names, and JSON property names are user data and must not be translated or rewritten.
- Previews do not move files. Execution and undo require explicit controls, and undo remains bound to the reviewed run.
- No Apple account, company permission, or signing certificate is required for local builds. macOS signing is explicitly disabled.

## Brand Commitments

File Tidy name and existing folder/check application icon remain. No decorative arrows or chevrons in controls, navigation, hover/focus states, SVGs, or pseudo-elements. App-owned choice controls remain arrowless, including browser-drawn `select` and `datalist` indicators. Preserve keyboard and accessibility semantics; only OS-owned file-dialog navigation retains necessary direction controls.

## Evidence on Hand

The existing shared core, default classification rules, local run manifests, automated file-move tests, and Electron runtime provide real data. Empty workspaces must not show fabricated files or successful runs.

## Product Principles

- Put folder selection and preview in one working view.
- Make file destinations and consequences readable before execution.
- Keep classification rules consistent across all three adapters.
- Language changes preserve the user's current inputs, preview, and unsaved edits.
