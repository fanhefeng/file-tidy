import type { Locale } from "../locale.js";

type ErrorData = {
  code?: string;
  message?: string;
  field?: string;
  reason?: string;
  configPath?: string;
  label?: string;
};
type Message = (data: ErrorData) => string;
const messages: Record<string, { en: Message; "zh-CN": Message }> = {
  CONFIG_PARSE: {
    en: (e) => `The rules file is not valid JSON. Check ${e.configPath}.`,
    "zh-CN": (e) => `规则文件不是有效的 JSON，请检查 ${e.configPath}。`,
  },
  CONFIG_INVALID: {
    en: (e) => `Invalid rule at ${e.field ?? "config"}: ${e.reason ?? e.message}`,
    "zh-CN": (e) => `规则字段 ${e.field ?? "config"} 无效：${localizedReason(e.reason)}`,
  },
  CONFIG_WRITE: {
    en: (e) => `Could not save the rules file at ${e.configPath}. Check folder permissions.`,
    "zh-CN": (e) => `无法保存分类规则文件 ${e.configPath}，请检查这个文件夹是否允许写入。`,
  },
  INVALID_SEGMENT: {
    en: () => "A configured folder name is invalid. Use a single folder name without path separators.",
    "zh-CN": () => "分类文件夹的名称有误，请填写单个文件夹名称，不要包含 / 或 \\。",
  },
  TIDY_DIR_ESCAPES: {
    en: () => "The destination's .tidy folder points outside the destination. Choose another destination.",
    "zh-CN": () => "存放位置中的 .tidy 链接到了其他文件夹，无法保存整理记录。请选择其他存放位置。",
  },
  MANIFEST_CORRUPT: {
    en: () =>
      "The latest organization record cannot be read, so it cannot be undone automatically. Files have been left where they are.",
    "zh-CN": () => "无法读取最近一次整理的记录，暂时不能自动撤销。文件仍保留在当前位置。",
  },
  EXDEV_VERIFY: {
    en: () => "A file copy could not be verified. The source file has been preserved.",
    "zh-CN": () => "无法验证复制的文件，源文件已保留。",
  },
  ENOENT: {
    en: () => "A file or folder is no longer available. Check the folders and preview again.",
    "zh-CN": () => "文件或文件夹已不存在，请检查所选位置后重新预览。",
  },
  EACCES: {
    en: () => "File Tidy cannot access this location. Check its file and folder permissions.",
    "zh-CN": () => "File Tidy 无法读取或写入这个位置，请检查文件夹的访问权限。",
  },
  ENOSPC: {
    en: () => "The destination is out of space. Free up space before continuing.",
    "zh-CN": () => "存放位置的磁盘空间不足，请腾出空间后重试。",
  },
  PATH_ABSOLUTE: {
    en: (e) =>
      `Use Choose to select ${e.label === "source" ? "a folder to organize" : "where organized files will go"}, or enter its full path.`,
    "zh-CN": (e) => `请点击「选择」指定${e.label === "source" ? "待整理文件夹" : "整理后的存放位置"}，或填写完整路径。`,
  },
  PATH_DIRECTORY: {
    en: (e) =>
      `${e.label === "source" ? "The location to organize" : "The location for organized files"} must be a folder, not a file.`,
    "zh-CN": (e) => `${e.label === "source" ? "待整理位置" : "整理后的存放位置"}必须是文件夹，不能选择单个文件。`,
  },
  FILE_CHANGED: {
    en: () => "A previewed file changed. Preview again before organizing.",
    "zh-CN": () => "预览中的文件已发生变化，请重新预览后再整理。",
  },
  FILE_CHANGED_ANALYSIS: {
    en: () => "A file changed during analysis. Preview the folder again.",
    "zh-CN": () => "分析期间有文件发生变化，请重新预览。",
  },
  CONFIG_TOO_LARGE: {
    en: () => "Rules must be a JSON document under 1 MB.",
    "zh-CN": () => "规则必须是小于 1 MB 的 JSON 文档。",
  },
  JSON_INVALID: {
    en: () => "The rules are not valid JSON. Check commas, quotes, and brackets.",
    "zh-CN": () => "规则不是有效的 JSON，请检查逗号、引号和括号。",
  },
  INVALID_PREVIEW: {
    en: () => "Invalid preview options.",
    "zh-CN": () => "整理选项有误，请重新选择后预览。",
  },
  ROOTS_OVERLAP: {
    en: () =>
      "Choose separate folders: they cannot be the same or sit inside each other. To use one folder, turn on Organize within this folder.",
    "zh-CN": () =>
      "待整理文件夹和存放位置不能相同，也不能一个位于另一个里面。要在同一文件夹中整理，请开启「在当前文件夹内整理」。",
  },
  CONFIG_CHANGED_ANALYSIS: {
    en: () => "The rules changed during analysis. Preview the folder again.",
    "zh-CN": () => "分析期间规则已发生变化，请重新预览。",
  },
  CONFIG_CHANGED: {
    en: () => "The rules changed. Preview again before organizing.",
    "zh-CN": () => "分类规则已发生变化，请重新预览后再整理。",
  },
  PLAN_STALE: {
    en: (e) =>
      e.reason === "config"
        ? "The rules changed. Preview again before organizing."
        : e.reason === "destination"
          ? "The selected destination changed. Check the folder and preview again before organizing."
          : e.reason === "keeper"
            ? "A duplicate's kept copy changed or is no longer available. Preview again before organizing."
            : "A previewed file changed or is no longer available. Preview again before organizing.",
    "zh-CN": (e) =>
      e.reason === "config"
        ? "分类规则已发生变化，请重新预览后再整理。"
        : e.reason === "destination"
          ? "整理后的存放位置已发生变化，请检查文件夹并重新预览后再整理。"
          : e.reason === "keeper"
            ? "重复文件的保留副本已发生变化或不存在，请重新预览后再整理。"
            : "预览中的文件已发生变化或不存在，请重新预览后再整理。",
  },
  PREVIEW_EXPIRED: {
    en: () => "This preview has expired. Preview the folder again.",
    "zh-CN": () => "此预览已失效，请重新预览文件夹。",
  },
  PATH_ESCAPES: {
    en: () => "A file path leaves the selected folders. Preview again after checking symbolic links.",
    "zh-CN": () => "有文件路径指向了所选文件夹之外。请检查文件夹中指向其他位置的链接（符号链接），然后重新预览。",
  },
  PLAN_EMPTY: {
    en: () => "There are no files to organize.",
    "zh-CN": () => "没有需要整理的文件。",
  },
  UNDO_SELECTION: {
    en: () => "Choose a recorded run to undo.",
    "zh-CN": () => "请先在「整理记录」中选择要撤销的整理。",
  },
  UNDO_CHANGED: {
    en: () => "The latest organization record changed. Check the updated record before undoing it.",
    "zh-CN": () => "最近一次整理记录已变化，请先确认更新后的记录，再撤销。",
  },
  UNKNOWN_OPERATION: {
    en: () => "Unknown desktop operation.",
    "zh-CN": () => "无法识别此操作，请重新打开应用后重试。",
  },
  BACKGROUND_STOPPED: {
    en: () => "The background operation stopped. Preview again; completed moves can be undone.",
    "zh-CN": () => "文件处理已中断，请重新预览；已经移动的文件仍可在「整理记录」中撤销。",
  },
  WINDOW_UNAVAILABLE: {
    en: () => "This operation is not available in this window.",
    "zh-CN": () => "无法在此窗口执行该操作。",
  },
  REPORT_UNAVAILABLE: {
    en: () =>
      "This report is no longer available. Check the destination folder or organize again to create a new report.",
    "zh-CN": () => "这份说明已不存在或位置发生了变化，请检查整理后的文件夹，或重新整理生成说明。",
  },
  REPORT_OPEN_FAILED: {
    en: () => "The report could not be opened. Choose an app that can open Markdown files and try again.",
    "zh-CN": () => "无法打开这份说明，请为 Markdown 文件选择可用的打开方式后重试。",
  },
  OPERATION_FAILED: {
    en: () => "The operation could not be completed. Preview again; completed moves can be undone.",
    "zh-CN": () => "操作未能完成，请重新预览；已完成的移动仍可撤销。",
  },
  LOCALE_INVALID: {
    en: () => "Choose Simplified Chinese or English.",
    "zh-CN": () => "请选择简体中文或英语。",
  },
  PREFERENCES_WRITE: {
    en: () => "The language preference could not be saved. Check the app data folder permissions.",
    "zh-CN": () => "语言选择未能保存，请检查应用数据文件夹是否允许写入。",
  },
};

const reasons: Record<string, string> = {
  "must be a safe folder name": "请填写单个文件夹名称，不要包含 /、\\ 或系统保留名称",
  "is reserved for quarantine": "此名称保留给隔离目录使用",
  "must be a file extension without wildcards or path separators": "请填写 mp3 这样的文件后缀，不要包含星号或路径",
  "is not a supported setting": "不支持此配置项",
  "must be a path or null": "请填写文件夹路径；不设置时请使用 null",
  "must be a safe folder prefix": "必须是有效的文件夹前缀",
  "must be an object": "必须是对象",
  "must be a list of extensions": "必须是文件后缀列表",
  "duplicates an extension after normalization": "与另一个后缀规则重复",
  "must be a category or rule object": "必须是类别名称或规则对象",
  "is not a supported rule setting": "不支持此规则配置项",
  "must be month, year, or none": "必须是 month、year 或 none",
  "must be a list of rules": "必须是规则列表",
  "must be a rule object": "必须是规则对象",
  "must be a list of regular expressions": "必须是正则表达式列表",
  "contains an invalid regular expression": "包含无效的正则表达式",
  "must be false or an object": "必须是 false 或对象",
  "must be a supported boolean switch": "必须是支持的布尔开关",
  "must be an integer from 0 to 64": "必须是 0 到 64 之间的整数",
};

function localizedReason(reason?: string) {
  if (reason?.startsWith("must be a list of unique metadata fields:")) {
    return "必须是由 artist、albumArtist、album、title、genre、year 组成的不重复列表";
  }
  return reason && reasons[reason] ? reasons[reason] : "请检查这一项的填写方式";
}

export function desktopError(code: string, detail: Record<string, unknown> = {}): Error & { code: string } {
  const error = Object.assign(new Error(), detail, { code });
  error.message = describeError(error, "en");
  return error;
}

export function describeError(error: unknown, locale: Locale = "en"): string {
  const e: ErrorData = typeof error === "object" && error !== null ? error : {};
  const code = e.code === "EPERM" ? "EACCES" : e.code;
  const message = code ? messages[code] : undefined;
  return message?.[locale](e) ?? (locale === "en" && e.message ? e.message : messages.OPERATION_FAILED[locale](e));
}

export function describeReportError(report: string, locale: Locale = "en"): string {
  if (locale === "zh-CN") return `文件已整理，但${report === "duplicates" ? "重复文件" : "相似文件"}报告未能保存。`;
  return `Files were organized, but the ${report} report could not be saved.`;
}
