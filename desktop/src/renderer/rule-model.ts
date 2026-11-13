export type RuleObject = Record<string, unknown>;
export type CategoryGranularity = "month" | "year" | "none";
export interface SubRule extends RuleObject {
  name: string;
  exts?: string[];
  match?: string[];
}

export interface EffectiveRules {
  categories: Record<string, string[]>;
  granularity: Record<string, CategoryGranularity>;
  groupBy: Record<string, string[]>;
  subCategories: Record<string, SubRule[]>;
  extensions: RuleObject;
  fallbackCategory: string;
}

export interface RulesSnapshot {
  raw: RuleObject | null;
  parsed: RuleObject | null;
  effective: EffectiveRules | null;
}

export interface CategorySummary {
  name: string;
  extensions: string[];
  groupBy: string[];
  granularity: CategoryGranularity;
  subRuleCount: number;
  isFallback: boolean;
}

const mapKeys = ["categories", "granularity", "groupBy", "subCategories", "extensions"] as const;

function isObject(value: unknown): value is RuleObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isGranularity(value: unknown): value is CategoryGranularity {
  return value === "month" || value === "year" || value === "none";
}

function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

function validExtension(value: string): boolean {
  return /^[a-z0-9][a-z0-9_+-]*(?:\.[a-z0-9][a-z0-9_+-]*)*$/i.test(value);
}

function folderError(name: string): SubRuleErrors["name"] {
  const folder = name.trim();
  if (!folder) return "requiredCategory";
  if (/[\\/<>:"|?*]|\p{Cc}|\p{Cf}/u.test(folder)) return "invalidCategory";
  if (
    folder === "." ||
    folder === ".." ||
    /^(?:\.tidy|duplicates|review)$/i.test(folder) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)
  )
    return "reservedCategory";
  if (folder.endsWith(".")) return "invalidCategoryEnding";
  return undefined;
}

function isSubRule(value: unknown): value is SubRule {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    (value.exts === undefined || isStringList(value.exts)) &&
    (value.match === undefined || isStringList(value.match))
  );
}

function own(object: RuleObject, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function mapAt(object: RuleObject, key: string): RuleObject {
  if (!Object.hasOwn(object, key)) return {};
  const map = object[key];
  if (!isObject(map)) throw new TypeError(`${key} must be an object`);
  return map;
}

function hasUsableMaps(object: RuleObject): boolean {
  for (const key of mapKeys) {
    if (Object.hasOwn(object, key) && !isObject(object[key])) return false;
  }
  const entries = (key: string) => Object.values(mapAt(object, key));
  return (
    entries("categories").every(isStringList) &&
    entries("granularity").every(isGranularity) &&
    entries("groupBy").every(isStringList) &&
    entries("subCategories").every((rules) => Array.isArray(rules) && rules.every(isSubRule)) &&
    entries("extensions").every(
      (rule) => typeof rule === "string" || (isObject(rule) && typeof own(rule, "category") === "string"),
    ) &&
    (!Object.hasOwn(object, "fallbackCategory") || typeof object.fallbackCategory === "string")
  );
}

/** Summarize a resolved configuration using the core extension override order. */
export function getCategorySummaries(config: RuleObject): CategorySummary[] {
  if (!isObject(config) || !hasUsableMaps(config) || !isObject(own(config, "categories"))) return [];
  const fallback = own(config, "fallbackCategory");
  if (typeof fallback !== "string") return [];

  const categories = mapAt(config, "categories");
  const overrides = mapAt(config, "extensions");
  const groupBy = mapAt(config, "groupBy");
  const granularity = mapAt(config, "granularity");
  const subCategories = mapAt(config, "subCategories");
  const names = new Set(Object.keys(categories));
  const extensionIndex = new Map<string, string>();
  for (const [name, exts] of Object.entries(categories)) {
    for (const ext of exts as string[]) extensionIndex.set(normalizeExtension(ext), name);
  }
  for (const [ext, rule] of Object.entries(overrides)) {
    const name = typeof rule === "string" ? rule : (own(rule as RuleObject, "category") as string);
    names.add(name);
    extensionIndex.set(normalizeExtension(ext), name);
  }
  names.add(fallback);

  const extensionsByCategory = new Map<string, string[]>();
  for (const [ext, name] of extensionIndex) {
    const list = extensionsByCategory.get(name) ?? [];
    list.push(ext);
    extensionsByCategory.set(name, list);
  }
  return [...names].map((name) => {
    const grouping = own(groupBy, name);
    const dateGrouping = own(granularity, name);
    const rules = own(subCategories, name);
    return {
      name,
      extensions: extensionsByCategory.get(name) ?? [],
      groupBy: isStringList(grouping) ? [...grouping] : [],
      granularity: isGranularity(dateGrouping) ? dateGrouping : "none",
      subRuleCount: Array.isArray(rules) ? rules.length : 0,
      isFallback: name === fallback,
    };
  });
}

export function parseRuleDraft(draft: string): RuleObject | null {
  try {
    const parsed: unknown = JSON.parse(draft);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeRuleDraft(raw: RuleObject): string {
  return JSON.stringify(raw, null, 2);
}

/** Resolve only the editable shape; the shared core remains the save-time validator. */
export function getRulesSnapshot(draft: string, defaults: RuleObject | null): RulesSnapshot {
  const raw = parseRuleDraft(draft);
  if (!raw || !defaults || !hasUsableMaps(raw) || !hasUsableMaps(defaults))
    return { raw, parsed: raw, effective: null };

  const replaceMap = (key: string) => structuredClone(mapAt(Object.hasOwn(raw, key) ? raw : defaults, key));
  const mergeMap = (key: string) => structuredClone({ ...mapAt(defaults, key), ...mapAt(raw, key) });
  const effective: EffectiveRules = {
    categories: replaceMap("categories") as EffectiveRules["categories"],
    granularity: mergeMap("granularity") as EffectiveRules["granularity"],
    groupBy: mergeMap("groupBy") as EffectiveRules["groupBy"],
    subCategories: replaceMap("subCategories") as EffectiveRules["subCategories"],
    // Core extension overrides are raw-only; built-in extensions live in categories.
    extensions: structuredClone(mapAt(raw, "extensions")),
    fallbackCategory: (own(raw, "fallbackCategory") ?? own(defaults, "fallbackCategory") ?? "Others") as string,
  };
  return { raw, parsed: raw, effective };
}

export function setCategoryGranularity(raw: RuleObject, category: string, value: CategoryGranularity): RuleObject {
  if (!isGranularity(value)) throw new TypeError("Invalid date grouping");
  return { ...raw, granularity: { ...mapAt(raw, "granularity"), [category]: value } };
}

export function setCategoryExtensions(
  raw: RuleObject,
  category: string,
  exts: string[],
  defaults: RuleObject | null,
): RuleObject {
  if (!isStringList(exts)) throw new TypeError("Extensions must be a list");
  const normalized = [...new Set(exts.map(normalizeExtension))];
  if (normalized.some((ext) => !validExtension(ext))) throw new TypeError("Invalid file extension");
  const source = Object.hasOwn(raw, "categories") ? raw : defaults;
  if (!source) throw new TypeError("Default rules are not loaded");
  const categories = mapAt(source, "categories");
  return { ...raw, categories: { ...structuredClone(categories), [category]: normalized } };
}

export function setCategorySubRules(
  raw: RuleObject,
  category: string,
  rules: SubRule[],
  defaults: RuleObject | null,
): RuleObject {
  if (!Array.isArray(rules) || !rules.every(isSubRule)) throw new TypeError("Invalid subcategory rules");
  const source = Object.hasOwn(raw, "subCategories") ? raw : defaults;
  if (!source) throw new TypeError("Default rules are not loaded");
  const subCategories = mapAt(source, "subCategories");
  return { ...raw, subCategories: { ...structuredClone(subCategories), [category]: structuredClone(rules) } };
}

export interface SubRuleErrors {
  name?: "requiredCategory" | "invalidCategory" | "reservedCategory" | "invalidCategoryEnding";
  extensions?: "invalidExtension" | "requiredMatch";
  patterns?: "invalidPattern";
}

export function validateSubRule(
  name: string,
  extensionsText: string,
  patternsText: string,
): {
  errors: SubRuleErrors;
  rule: SubRule | null;
} {
  const errors: SubRuleErrors = {};
  const nameError = folderError(name);
  if (nameError) errors.name = nameError;
  const exts = [
    ...new Set(
      extensionsText
        .split(/[\s,，]+/u)
        .filter(Boolean)
        .map(normalizeExtension),
    ),
  ];
  const patterns = patternsText.split(/\r?\n/).filter((source) => source.trim().length > 0);
  if (exts.some((ext) => !validExtension(ext))) errors.extensions = "invalidExtension";
  if (!exts.length && !patterns.length) errors.extensions = "requiredMatch";
  for (const source of patterns) {
    try {
      new RegExp(source, "i");
    } catch {
      errors.patterns = "invalidPattern";
      break;
    }
  }
  return {
    errors,
    rule: Object.keys(errors).length
      ? null
      : { name: name.trim(), ...(exts.length ? { exts } : {}), ...(patterns.length ? { match: patterns } : {}) },
  };
}
