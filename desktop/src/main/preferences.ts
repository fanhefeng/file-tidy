import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isLocale, resolveLocale } from "../locale.js";
import type { Locale } from "../locale.js";
import type { UiPreferences } from "../shared.js";
import { desktopError } from "./errors.js";

export function readPreferences(filePath: string, systemLocale: string): UiPreferences {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (isLocale(raw?.locale)) return { locale: raw.locale };
  } catch {
    // A missing or damaged UI preference must not prevent access to the files.
  }
  return { locale: resolveLocale(systemLocale) };
}

export function writePreferences(filePath: string, value: unknown): UiPreferences {
  if (!isLocale(value)) throw desktopError("LOCALE_INVALID");
  const preferences: { locale: Locale } = { locale: value };
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(preferences, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    fs.renameSync(temporary, filePath);
  } catch (cause) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      /* Preserve the original failure. */
    }
    throw desktopError("PREFERENCES_WRITE", { cause });
  }
  return preferences;
}
