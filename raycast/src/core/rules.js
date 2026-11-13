/** Classification rules are pure: filesystem and tag readers supply data separately. */
export function buildExtensionIndex(config) {
  const index = new Map();
  for (const [category, exts] of Object.entries(config.categories ?? {})) {
    if (!Array.isArray(exts)) continue;
    for (const ext of exts) index.set(String(ext).toLowerCase().replace(/^\./, ""), category);
  }
  for (const [ext, rule] of Object.entries(config.extensions ?? {})) {
    index.set(ext.toLowerCase().replace(/^\./, ""), typeof rule === "string" ? rule : rule.category);
  }
  return index;
}

export function classify(file, extIndex, fallbackCategory) {
  return matchExtension(file, extIndex)?.[1] ?? fallbackCategory;
}

function matchExtension(file, index) {
  const name = file.name.toLowerCase();
  // Enumerate suffixes longest-first, rather than scanning every configured rule per file.
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const suffix = name.slice(dot + 1);
    if (index.has(suffix)) return [suffix, index.get(suffix)];
  }
  return index.has(file.ext) ? [file.ext, index.get(file.ext)] : null;
}

export function buildSubIndex(subCategories = {}) {
  const index = new Map();
  for (const [category, rules] of Object.entries(subCategories)) {
    if (!Array.isArray(rules)) continue;
    const compiled = [];
    for (const rule of rules) {
      if (!rule?.name) continue;
      const exts = new Set(list(rule.exts).map((e) => String(e).toLowerCase().replace(/^\./, "")));
      const patterns = [];
      for (const src of list(rule.match)) {
        try {
          patterns.push(new RegExp(src, "i"));
        } catch {
          /* Legacy callers skip broken patterns. */
        }
      }
      if (!exts.size && !patterns.length) continue;
      compiled.push({
        name: rule.name,
        test: (file) => exts.has(file.ext) || patterns.some((re) => re.test(file.name)),
      });
    }
    if (compiled.length) index.set(category, compiled);
  }
  return index;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

export function subClassify(file, category, subIndex) {
  for (const rule of subIndex.get(category) ?? []) if (rule.test(file)) return rule.name;
  return null;
}

/** Compile once per analysis; metadata fields are instructions, never paths. */
export function compileRules(config) {
  const extIndex = buildExtensionIndex(config);
  const subIndex = buildSubIndex(config.subCategories);
  const overrides = new Map(
    Object.entries(config.extensions ?? {}).map(([ext, value]) => [ext.toLowerCase().replace(/^\./, ""), value]),
  );
  return (file) => {
    const matched = matchExtension(file, extIndex);
    const category = matched?.[1] ?? config.fallbackCategory;
    const override = matched && overrides.get(matched[0]);
    const rule = override && typeof override === "object" ? override : {};
    return {
      category,
      subCategory: subClassify(file, category, subIndex),
      groupBy: rule.groupBy ?? own(config.groupBy, category) ?? [],
      granularity: rule.granularity ?? own(config.granularity, category) ?? "none",
      matchedExtension: matched?.[0] ?? null,
    };
  };
}

function own(object, key) {
  return object && Object.hasOwn(object, key) ? object[key] : undefined;
}

const UNKNOWN = {
  artist: "Unknown Artist",
  albumArtist: "Unknown Album Artist",
  album: "Unknown Album",
  genre: "Unknown Genre",
  year: "Unknown Year",
};

/** Tag values can contain slashes, control characters and Windows device names. */
export function metadataSegment(value, fallback) {
  let result = String(value ?? "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*]|\p{Cc}|\p{Cf}/gu, "_")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  // Most filesystems cap segments by bytes; 100 Chinese characters already exceed 255 bytes.
  let bytes = 0;
  let limited = "";
  for (const character of result) {
    const cp = character.codePointAt(0);
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (bytes > 200) break;
    limited += character;
  }
  result = limited.replace(/[. ]+$/g, "");
  if (!result || result.toLowerCase() === ".tidy") return fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result;
}

export function groupingSegments(file, fields, metadata = {}) {
  const stem = file.name.slice(0, file.name.length - (file.ext ? file.ext.length + 1 : 0));
  return fields.map((field) => {
    const fallback = field === "title" ? metadataSegment(stem, "Untitled") : (UNKNOWN[field] ?? "Unknown");
    const value = field === "albumArtist" ? (metadata.albumArtist ?? metadata.artist) : metadata[field];
    return metadataSegment(value, fallback);
  });
}
