import type { RuleCopyKey } from "./rule-copy";

export interface RuleFieldErrors {
  extension?: RuleCopyKey;
  category?: RuleCopyKey;
}

export function normalizeExtension(value: string) {
  return value.trim().toLowerCase().replace(/^\./, "");
}

export function validateFileTypeRule(
  extension: string,
  category: string,
  extensions: Record<string, unknown>,
): RuleFieldErrors {
  const errors: RuleFieldErrors = {};
  const normalized = normalizeExtension(extension);
  const folder = category.trim();

  if (!extension.trim()) errors.extension = "requiredExtension";
  else if (!/^[a-z0-9][a-z0-9_+-]*(?:\.[a-z0-9][a-z0-9_+-]*)*$/i.test(normalized))
    errors.extension = "invalidExtension";
  else if (Object.keys(extensions).some((key) => normalizeExtension(key) === normalized))
    errors.extension = "duplicateExtension";

  if (!folder) errors.category = "requiredCategory";
  else if (/[\\/<>:"|?*]|\p{Cc}|\p{Cf}/u.test(folder)) errors.category = "invalidCategory";
  else if (
    folder === "." ||
    folder === ".." ||
    /^(?:\.tidy|duplicates|review)$/i.test(folder) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)
  )
    errors.category = "reservedCategory";
  else if (folder.endsWith(".")) errors.category = "invalidCategoryEnding";

  return errors;
}
