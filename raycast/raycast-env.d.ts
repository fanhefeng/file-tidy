/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** Default Destination - Used when no destination is picked in the form; leave unset to always pick one explicitly */
  "defaultDest"?: string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `tidy-folder` command */
  export type TidyFolder = ExtensionPreferences & {}
  /** Preferences accessible in the `undo-tidy` command */
  export type UndoTidy = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `tidy-folder` command */
  export type TidyFolder = {}
  /** Arguments passed to the `undo-tidy` command */
  export type UndoTidy = {}
}

