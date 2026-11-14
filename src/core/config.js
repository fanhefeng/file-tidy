import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildExtensionIndex } from "./rules.js";
import { fileRevision } from "./revision.js";

const CONFIG_PATH = resolveConfigPath();

/**
 * Windows: %APPDATA%\tidy\config.json; elsewhere: $XDG_CONFIG_HOME or
 * ~/.config (so the macOS path stays exactly where it always was).
 */
export function resolveConfigPath() {
  const base =
    process.platform === "win32"
      ? (process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"))
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
  return path.join(base, "tidy", "config.json");
}

export const DEFAULT_CONFIG = {
  // null = ask at runtime (Enter defaults to the current working directory)
  dest: null,
  categories: {
    Images: [
      "jpg",
      "jpeg",
      "png",
      "heic",
      "heif",
      "gif",
      "webp",
      "raw",
      "dng",
      "tiff",
      "tif",
      "bmp",
      "avif",
      "svg",
      "ico",
      "cr2",
      "cr3",
      "nef",
      "arw",
      "orf",
      "raf",
    ],
    Videos: ["mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv", "flv", "mpeg", "mpg", "mts", "m2ts", "3gp"],
    Audios: [
      "mp3",
      "m4a",
      "wav",
      "flac",
      "aac",
      "ogg",
      "caf",
      "aiff",
      "aif",
      "wma",
      "opus",
      "alac",
      "ape",
      "aifc",
      "wv",
      "m4b",
      "amr",
    ],
    Documents: [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "md",
      "txt",
      "rtf",
      "csv",
      "pages",
      "numbers",
      "key",
      "epub",
      "mobi",
      "azw3",
      "azw",
    ],
    Archives: [
      "zip",
      "rar",
      "7z",
      "tar",
      "gz",
      "bz2",
      "xz",
      "dmg",
      "iso",
      "pkg",
      "exe",
      "msi",
      "apk",
      "deb",
      "rpm",
      "tgz",
      "zst",
    ],
    Fonts: ["ttf", "otf", "ttc", "woff", "woff2", "eot"],
    Code: [
      "js",
      "jsx",
      "ts",
      "tsx",
      "mjs",
      "cjs",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "kt",
      "swift",
      "c",
      "cpp",
      "h",
      "hpp",
      "cs",
      "php",
      "sh",
      "html",
      "css",
      "scss",
      "vue",
      "svelte",
      "sql",
    ],
    Data: ["json", "jsonl", "ndjson", "xml", "yaml", "yml", "toml", "ini", "sqlite", "sqlite3", "db", "parquet"],
    Design: ["psd", "psb", "ai", "eps", "sketch", "fig", "xd", "blend", "obj", "fbx", "stl"],
  },
  // Explicit overrides extend the built-ins without copying the entire map.
  extensions: {},
  groupBy: { Audios: ["artist", "album"] },
  fallbackCategory: "Others",

  // Prefix on every folder tidy creates ("ft_" = file-tidy), so its output is
  // visually distinct from folders the user made by hand. "" = old naming.
  folderPrefix: "ft_",

  /**
   * Date bucket depth per category: "month" | "year" | "none".
   * Photos and videos carry a real capture date, so year-month is meaningful.
   * Fonts, installers and ebooks only carry a download date — bucketing those
   * by month scatters one logical set across a dozen folders for no reason.
   */
  granularity: {
    Images: "month",
    Videos: "month",
    Documents: "year",
    Audios: "none",
    Archives: "none",
    Fonts: "none",
    Code: "none",
    Data: "none",
    Design: "none",
    Others: "none",
  },

  /**
   * Optional second level inside a category, matched top-down on the file name
   * (and extension). First rule that matches wins; no match = no subfolder.
   * `match` entries are case-insensitive regex sources; `exts` are extensions.
   */
  subCategories: {
    Images: [
      {
        name: "Screenshots",
        match: ["screen ?shot", "screen ?capture", "截屏", "屏幕快照", "屏幕截图", "snipaste", "cleanshot"],
      },
      { name: "Screencasts", match: ["screen ?record", "screencast", "录屏", "屏幕录制"] },
      { name: "Wallpapers", match: ["wallpaper", "壁纸"] },
    ],
    Videos: [{ name: "Screencasts", match: ["screen ?record", "screencast", "录屏", "屏幕录制"] }],
    Documents: [
      { name: "Ebooks", exts: ["epub", "mobi", "azw3", "azw"] },
      { name: "Invoices", match: ["invoice", "receipt", "发票", "账单", "回执"] },
      { name: "Contracts", match: ["contract", "agreement", "\\bnda\\b", "合同", "协议", "授权书"] },
      { name: "Resumes", match: ["resume", "\\bcv\\b", "简历"] },
      { name: "Papers", match: ["thesis", "dissertation", "论文", "开题", "文献"] },
      { name: "Spreadsheets", exts: ["xls", "xlsx", "csv", "numbers"] },
      { name: "Slides", exts: ["ppt", "pptx", "key"] },
    ],
    Archives: [{ name: "Installers", exts: ["dmg", "pkg", "exe", "msi", "iso", "apk", "deb", "rpm"] }],
  },

  /** Extra passes beyond byte-level dedup. All are advisory unless noted. */
  detect: {
    /** Same-content-different-encoding candidates: normalized names, same stem
     *  across formats, version-numbered releases. Flagged in the plan only. */
    similar: true,
    /** Zero-byte files, extension/magic-number mismatches, OS junk.
     *  Junk and broken files are moved to the review folder. */
    health: true,
    /** Visually near-identical images (bursts, re-exports, re-compressions).
     *  Flagged in the plan only. Needs image decoding — see phash.js. */
    perceptual: true,
  },

  /** Hamming distance under which two image hashes count as near-identical. */
  perceptualThreshold: 5,
};

/** Folders tidy creates itself (before the prefix is applied). */
export const DUPLICATES_DIR = "Duplicates";
export const REVIEW_DIR = "Review";
/** Bookkeeping folder: run manifests and the perceptual-hash cache. */
export const TIDY_DIR = ".tidy";

/**
 * Base names introduced together with (or after) the folder prefix — 0.4.0
 * never created an un-prefixed folder of these names, so an existing one in
 * destDir is the user's own and must never be adopted as tidy territory.
 */
const POST_PREFIX_BASES = new Set([REVIEW_DIR, "Fonts", "Code", "Data", "Design"]);

/**
 * Canonicalize a path for containment checks: resolve symlinks (macOS's
 * /var → /private/var, case-insensitive spellings, …). For a path that
 * doesn't exist yet, canonicalize its deepest existing ancestor and
 * re-append the remainder.
 */
export function canonicalPath(p) {
  let dir = path.resolve(p);
  let rest = "";
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) return rest ? path.join(dir, rest) : dir;
    rest = rest ? path.join(path.basename(dir), rest) : path.basename(dir);
    dir = parent;
  }
  const real = fs.realpathSync(dir);
  return rest ? path.join(real, rest) : real;
}

/**
 * True when child is parent itself or nested anywhere under it.
 * path.relative handles case-insensitive drives/paths on Windows.
 * Callers should canonicalize both paths first (see canonicalPath).
 */
export function isInsideDir(parent, child) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function loadConfig(configPath = CONFIG_PATH) {
  configPath = path.resolve(configPath);
  if (!fs.existsSync(configPath)) {
    return { ...saveConfig({}, configPath), _created: true };
  }
  let raw;
  let revision;
  try {
    const contents = fs.readFileSync(configPath, "utf8");
    revision = fileRevision(configPath, contents);
    raw = JSON.parse(contents);
  } catch (err) {
    // code + configPath let adapters render this in their own language.
    const e = new Error(`Failed to parse config file (${configPath}): ${err.message}`, { cause: err });
    e.code = "CONFIG_PARSE";
    e.configPath = configPath;
    throw e;
  }
  return { ...resolveConfig(raw), _path: configPath, _revision: revision };
}

/** Pure configuration resolution shared by every adapter, including editors. */
export function resolveConfig(raw = {}) {
  // Preserve old empty/null files; reject malformed settings inside objects.
  const settings = isPlainObject(raw) ? structuredClone(raw) : {};
  validateConfig(settings);
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    ...Object.fromEntries(Object.entries(settings).filter(([key]) => !key.startsWith("_"))),
  };
  // Whole-map settings: a user-supplied value replaces the default outright,
  // so removing a category/rule in the config actually removes it. Only a real
  // object may replace one — a hand-edited scalar would otherwise wipe every
  // default and get iterated character by character downstream.
  if (isPlainObject(settings.categories)) config.categories = settings.categories;
  if (isPlainObject(settings.subCategories)) config.subCategories = settings.subCategories;
  // Keyed switches: merge, so writing one key doesn't silently reset the rest.
  // `detect: false` is the everything-off shorthand and passes through as-is.
  config.granularity = { ...DEFAULT_CONFIG.granularity, ...pick(settings.granularity) };
  config.groupBy = { ...structuredClone(DEFAULT_CONFIG.groupBy), ...structuredClone(pick(settings.groupBy) ?? {}) };
  config.extensions = Object.fromEntries(
    Object.entries(settings.extensions ?? {}).map(([ext, rule]) => [normalizeExtension(ext), structuredClone(rule)]),
  );
  config.detect = settings.detect === false ? false : { ...DEFAULT_CONFIG.detect, ...pick(settings.detect) };
  // Because categories replace rather than merge, a config written by an older
  // version silently misses categories added since. Report the gap so adapters
  // can point it out instead of quietly filing those files under Others — but
  // never patch it in: an absent category may well be a deliberate deletion.
  config._staleCategories = isPlainObject(settings.categories)
    ? Object.keys(DEFAULT_CONFIG.categories).filter((c) => !(c in settings.categories))
    : [];
  return config;
}

/** Validate before touching disk, then replace atomically so failed edits preserve the last valid file. */
export function saveConfig(raw, configPath = CONFIG_PATH) {
  const config = resolveConfig(raw);
  configPath = path.resolve(configPath);
  const serializable = Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith("_")));
  const contents = JSON.stringify(serializable, null, 2) + "\n";
  const temp = `${configPath}.${randomUUID()}.tmp`;
  let revision;
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(temp, contents, { flag: "wx", mode: 0o600 });
    fs.renameSync(temp, configPath);
    revision = fileRevision(configPath, contents);
  } catch (cause) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      /* Preserve the original write failure. */
    }
    const err = new Error(`Failed to write config file (${configPath})`, { cause });
    err.code = "CONFIG_WRITE";
    err.configPath = configPath;
    throw err;
  }
  return { ...config, _path: configPath, _revision: revision };
}

export const METADATA_FIELDS = ["artist", "albumArtist", "album", "title", "genre", "year"];
const GRANULARITIES = new Set(["month", "year", "none"]);

function invalid(field, reason) {
  const err = new Error(`Invalid config field ${field}: ${reason}`);
  err.code = "CONFIG_INVALID";
  err.field = field;
  err.reason = reason;
  throw err;
}

function validFolder(value, field) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value === "." ||
    value === ".." ||
    /[\\/<>:"|?*]|\p{Cc}|\p{Cf}/u.test(value) ||
    value.toLowerCase() === TIDY_DIR ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  )
    invalid(field, "must be a safe folder name");
  if ([DUPLICATES_DIR, REVIEW_DIR].some((reserved) => reserved.toLowerCase() === value.toLowerCase()))
    invalid(field, "is reserved for quarantine");
}

function normalizeExtension(value) {
  return value.toLowerCase().replace(/^\./, "");
}

function validExtension(value, field) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9][a-z0-9_+-]*(?:\.[a-z0-9][a-z0-9_+-]*)*$/i.test(normalizeExtension(value))
  )
    invalid(field, "must be a file extension without wildcards or path separators");
}

function validGrouping(value, field) {
  if (
    !Array.isArray(value) ||
    value.some((key) => !METADATA_FIELDS.includes(key)) ||
    new Set(value).size !== value.length
  )
    invalid(field, `must be a list of unique metadata fields: ${METADATA_FIELDS.join(", ")}`);
}

function validateConfig(settings) {
  for (const key of Object.keys(settings)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key) && !["_path", "_created", "_staleCategories", "_revision"].includes(key))
      invalid(key, "is not a supported setting");
  }
  if ("dest" in settings && settings.dest !== null && typeof settings.dest !== "string")
    invalid("dest", "must be a path or null");
  if ("fallbackCategory" in settings) validFolder(settings.fallbackCategory, "fallbackCategory");
  if (
    "folderPrefix" in settings &&
    (typeof settings.folderPrefix !== "string" || /[\\/<>:"|?*]|\p{Cc}|\p{Cf}/u.test(settings.folderPrefix))
  )
    invalid("folderPrefix", "must be a safe folder prefix");
  for (const key of ["categories", "extensions", "granularity", "groupBy", "subCategories"]) {
    if (key in settings && !isPlainObject(settings[key])) invalid(key, "must be an object");
  }
  for (const [category, exts] of Object.entries(settings.categories ?? {})) {
    validFolder(category, `categories.${category}`);
    if (!Array.isArray(exts)) invalid(`categories.${category}`, "must be a list of extensions");
    exts.forEach((ext, i) => validExtension(ext, `categories.${category}[${i}]`));
  }
  const seen = new Set();
  for (const [ext, rule] of Object.entries(settings.extensions ?? {})) {
    validExtension(ext, `extensions.${ext}`);
    const normalized = normalizeExtension(ext);
    if (seen.has(normalized)) invalid(`extensions.${ext}`, "duplicates an extension after normalization");
    seen.add(normalized);
    if (typeof rule === "string") validFolder(rule, `extensions.${ext}`);
    else {
      if (!isPlainObject(rule)) invalid(`extensions.${ext}`, "must be a category or rule object");
      for (const key of Object.keys(rule))
        if (!["category", "groupBy", "granularity"].includes(key))
          invalid(`extensions.${ext}.${key}`, "is not a supported rule setting");
      validFolder(rule.category, `extensions.${ext}.category`);
      if ("groupBy" in rule) validGrouping(rule.groupBy, `extensions.${ext}.groupBy`);
      if ("granularity" in rule && !GRANULARITIES.has(rule.granularity))
        invalid(`extensions.${ext}.granularity`, "must be month, year, or none");
    }
  }
  for (const [category, value] of Object.entries(settings.granularity ?? {})) {
    validFolder(category, `granularity.${category}`);
    if (!GRANULARITIES.has(value)) invalid(`granularity.${category}`, "must be month, year, or none");
  }
  for (const [category, value] of Object.entries(settings.groupBy ?? {})) {
    validFolder(category, `groupBy.${category}`);
    validGrouping(value, `groupBy.${category}`);
  }
  for (const [category, rules] of Object.entries(settings.subCategories ?? {})) {
    validFolder(category, `subCategories.${category}`);
    if (!Array.isArray(rules)) invalid(`subCategories.${category}`, "must be a list of rules");
    for (const [i, rule] of rules.entries()) {
      const field = `subCategories.${category}[${i}]`;
      if (!isPlainObject(rule)) invalid(field, "must be a rule object");
      validFolder(rule.name, `${field}.name`);
      if (rule.exts !== undefined) {
        if (!Array.isArray(rule.exts)) invalid(`${field}.exts`, "must be a list of extensions");
        rule.exts.forEach((ext, j) => validExtension(ext, `${field}.exts[${j}]`));
      }
      if (rule.match !== undefined) {
        if (!Array.isArray(rule.match) || rule.match.some((source) => typeof source !== "string"))
          invalid(`${field}.match`, "must be a list of regular expressions");
        for (const source of rule.match)
          try {
            new RegExp(source, "i");
          } catch {
            invalid(`${field}.match`, "contains an invalid regular expression");
          }
      }
    }
  }
  if ("detect" in settings && settings.detect !== false) {
    if (!isPlainObject(settings.detect)) invalid("detect", "must be false or an object");
    for (const [key, value] of Object.entries(settings.detect))
      if (!Object.hasOwn(DEFAULT_CONFIG.detect, key) || typeof value !== "boolean")
        invalid(`detect.${key}`, "must be a supported boolean switch");
  }
  if (
    "perceptualThreshold" in settings &&
    (!Number.isInteger(settings.perceptualThreshold) ||
      settings.perceptualThreshold < 0 ||
      settings.perceptualThreshold > 64)
  )
    invalid("perceptualThreshold", "must be an integer from 0 to 64");
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value if it can be merged over a defaults object, otherwise nothing. */
function pick(value) {
  return isPlainObject(value) ? value : null;
}

/**
 * Name folders as `${folderPrefix}${base}` — but if an un-prefixed folder of
 * that name already exists in destDir (and the prefixed one doesn't), keep
 * using it. That way turning the prefix on doesn't split an existing archive
 * into two parallel trees; only fresh destinations get the prefix.
 * Adoption is limited to names 0.4.0 could actually have created: a name from
 * POST_PREFIX_BASES that exists un-prefixed can only be the user's own folder.
 * Returns a memoized (base) => actualName function.
 */
export function buildFolderNamer(destDir, config) {
  const prefix = config.folderPrefix ?? "";
  const cache = new Map();
  return function folderName(base) {
    const hit = cache.get(base);
    if (hit !== undefined) return hit;
    let name = prefix ? prefix + base : base;
    if (
      prefix &&
      !POST_PREFIX_BASES.has(base) &&
      isDir(path.join(destDir, base)) &&
      !fs.existsSync(path.join(destDir, name))
    ) {
      name = base;
    }
    cache.set(base, name);
    return name;
  };
}

/**
 * A path inside destDir's bookkeeping folder, refused if anything along the way
 * is a symlink leading out of destDir. Manifests and the hash cache are written
 * and read through here, and undo acts on whatever a manifest says, so a
 * redirected `.tidy` (or `.tidy/runs`) turns "records for this destination"
 * into "records someone else planted".
 *
 * Every segment must be checked, not just the first: `.tidy` can be a genuine
 * directory while `runs` inside it is the link. Callers must route through this
 * rather than joining ".tidy" onto destDir themselves.
 */
export function tidyPath(destDir, ...sub) {
  const target = path.join(destDir, TIDY_DIR, ...sub);
  // No existsSync guard: canonicalPath resolves the deepest existing ancestor,
  // so a not-yet-created runs folder is still judged by whether the `.tidy`
  // above it is a link out of destDir.
  if (!isInsideDir(canonicalPath(destDir), canonicalPath(target))) {
    // code + destDir let adapters render this in their own language.
    const e = new Error(`${TIDY_DIR} in ${destDir} resolves outside it`);
    e.code = "TIDY_DIR_ESCAPES";
    e.destDir = destDir;
    e.path = target;
    throw e;
  }
  return target;
}

/** existsSync alone would also match a plain file, whose adoption later dies in mkdir with ENOTDIR. */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every folder name tidy may own in destDir, in every spelling it may carry on
 * disk: current prefix, the default prefix (in case the user changed prefixes
 * between runs), and — for names that predate the prefix — un-prefixed. Used
 * so in-place mode excludes them from the source scan and cross-run dedup can
 * find them however they were named.
 */
export function organizedDirNames(config) {
  const prefix = config.folderPrefix ?? "";
  const bases = [
    ...new Set([
      ...Object.keys(config.categories),
      ...Object.values(config.extensions ?? {}).map((rule) => (typeof rule === "string" ? rule : rule.category)),
      config.fallbackCategory,
      DUPLICATES_DIR,
      REVIEW_DIR,
    ]),
  ];
  const names = new Set();
  for (const b of bases) {
    if (!prefix || !POST_PREFIX_BASES.has(b)) names.add(b);
    names.add(prefix + b);
    names.add(DEFAULT_CONFIG.folderPrefix + b);
  }
  return names;
}

/**
 * Every spelling the quarantine folders may carry on disk. Rejected copies in
 * them must never re-enter a scan (as dedup keepers or archived content), no
 * matter which prefix was configured when they were created. Prefixes other
 * than the current and default ones aren't tracked — changing to a custom
 * prefix and back is on the user.
 */
export function quarantineDirNames(config) {
  const prefix = config.folderPrefix ?? "";
  const names = new Set();
  for (const b of [DUPLICATES_DIR, REVIEW_DIR]) {
    names.add(b);
    names.add(prefix + b);
    names.add(DEFAULT_CONFIG.folderPrefix + b);
  }
  return names;
}

/** Build a lowercase extension -> category lookup table. */
export function buildExtIndex(config) {
  return buildExtensionIndex(config);
}
