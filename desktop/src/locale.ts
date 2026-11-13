export type Locale = "zh-CN" | "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en"];

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en";
}

export function resolveLocale(value: unknown): Locale {
  return typeof value === "string" && /^zh(?:[-_]|$)/i.test(value) ? "zh-CN" : "en";
}
