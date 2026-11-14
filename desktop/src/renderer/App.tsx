import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Analysis, LastRun, PlanEntry, Progress, ReportReference, Settings, UndoFailure } from "../shared";
import type { Locale } from "../locale";
import { categoryLabel, dateLabel, numberLabel, translate, type MessageKey, type MessageValues } from "./i18n";
import { protectUnsavedChanges } from "./unsaved-changes";
import { RulesView } from "./RulesView";
import { getCategorySummaries } from "./rule-model";
import { ruleText } from "./rule-copy";
import appIcon from "../../resources/icon.png";

type View = "organize" | "rules" | "activity";
type Busy = "choose" | "analyze" | "execute" | "undo" | "save" | "defaults" | "language" | "report";
type Activity = {
  id: string;
  time: string;
  kind: "organized" | "restored";
  count: number;
  destination: string;
  manifestPath?: string;
  failures?: UndoFailure[];
  similarReport?: ReportReference | null;
};
type Notice = { tone: "success" | "warning" | "error"; key?: MessageKey; values?: MessageValues; detail?: string };
type IconName =
  "folder" | "rules" | "clock" | "file" | "check" | "music" | "image" | "search" | "shield" | "close" | "stack";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" />,
    rules: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="10" cy="18" r="2" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    file: (
      <>
        <path d="M6 3h8l4 4v14H6Z" />
        <path d="M14 3v5h4M9 12h6M9 16h5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    music: (
      <>
        <path d="M9 18V6l11-2v12M9 10l11-2" />
        <ellipse cx="6" cy="18" rx="3" ry="2" />
        <ellipse cx="17" cy="16" rx="3" ry="2" />
      </>
    ),
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 5-5 4 4 4-6 5 7" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 4 4" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    stack: (
      <>
        <rect x="4" y="3" width="12" height="14" rx="2" />
        <path d="M8 21h10a2 2 0 0 0 2-2V8M8 8h4M8 12h4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

const phaseKeys: Record<string, MessageKey> = {
  scanning: "phaseScanning",
  health: "phaseHealth",
  dedup: "phaseDedup",
  similar: "phaseSimilar",
  perceptual: "phasePerceptual",
  metadata: "phaseMetadata",
  planning: "phasePlanning",
};
const busyKeys: Record<Busy, MessageKey> = {
  choose: "busyChoose",
  analyze: "scanning",
  execute: "executing",
  undo: "busyUndo",
  save: "busySave",
  defaults: "busyDefaults",
  language: "busyLanguage",
  report: "busyReport",
};
const categoryColors: Record<string, string> = {
  Images: "violet",
  Videos: "rose",
  Audios: "amber",
  Documents: "blue",
  Archives: "sand",
  Fonts: "violet",
  Code: "teal",
  Data: "blue",
  Design: "rose",
};
function basename(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) || value;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function configText(config: Record<string, unknown>) {
  return JSON.stringify(Object.fromEntries(Object.entries(config).filter(([key]) => !key.startsWith("_"))), null, 2);
}
function relativePath(entry: PlanEntry, destination: string) {
  const prefix = destination.replace(/[\\/]+$/, "") + (entry.to.includes("\\") ? "\\" : "/");
  return entry.to.startsWith(prefix) ? entry.to.slice(prefix.length) : entry.to;
}
function fileSize(locale: Locale, bytes: number) {
  const unit = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4) : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit > 1 ? 1 : 0 }).format(bytes / 1024 ** unit)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}

function explanation(entry: PlanEntry): MessageKey | null {
  if (entry.issue === "empty") return "issueEmpty";
  if (entry.issue === "corrupt") return "issueCorrupt";
  if (entry.issue === "junk") return "issueJunk";
  if (entry.metadataStatus === "missing") return "metadataMissing";
  if (entry.metadataStatus === "unreadable") return "metadataUnreadable";
  if (entry.metadataStatus === "read") return "metadataRead";
  return null;
}

function SimilarDetails({ entry, locale }: { entry: PlanEntry; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const reasonKeys: Record<NonNullable<PlanEntry["similar"]>["reason"], MessageKey> = {
    "normalized-name": "similarNameReason",
    "same-stem": "similarStemReason",
    versioned: "similarVersionReason",
  };
  const groups = [
    ...(entry.similar
      ? [
          {
            ...entry.similar,
            reasonKey: reasonKeys[entry.similar.reason],
            newest: entry.similar.reason === "versioned",
          },
        ]
      : []),
    ...(entry.perceptual ? [{ ...entry.perceptual, reasonKey: "similarImageReason" as const, newest: false }] : []),
  ];
  if (!groups.length) return null;
  return (
    <div className="similar-details" data-testid="similar-files">
      {groups.map((group) => (
        <section key={group.reasonKey}>
          <p>{t(group.reasonKey)}</p>
          {group.best && <p>{t(group.newest ? "similarNewest" : "similarLargest")}</p>}
          <ul>
            {group.peers.map((peer) => (
              <li key={peer} dir="auto">
                <bdi>{peer}</bdi>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="similar-advisory">{t("similarAdvisory")}</p>
    </div>
  );
}

function UndoFailures({ failures, locale }: { failures: UndoFailure[]; locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const reasons: Record<UndoFailure["code"], MessageKey> = {
    missing: "undoMissing",
    occupied: "undoOccupied",
    error: "undoError",
  };
  const filesystemReasons: Record<string, MessageKey> = {
    EACCES: "undoPermission",
    EPERM: "undoPermission",
    ENOSPC: "undoNoSpace",
    ENOENT: "undoPathMissing",
    EEXIST: "undoPathBlocked",
    ENOTDIR: "undoPathBlocked",
  };
  return (
    <section className="undo-failures" data-testid="undo-failures" aria-label={t("undoFailures")}>
      <h4>{t("undoFailures")}</h4>
      <ul>
        {failures.map((failure) => (
          <li key={`${failure.from}-${failure.to}`}>
            <strong>
              <bdi>{basename(failure.from)}</bdi>
            </strong>
            <p>
              {t(
                failure.code === "error"
                  ? (filesystemReasons[failure.errorCode ?? ""] ?? "undoError")
                  : reasons[failure.code],
              )}
            </p>
            <dl>
              <div>
                <dt>{t("originalFolder")}</dt>
                <dd>
                  <bdi>{failure.from}</bdi>
                </dd>
              </div>
              <div>
                <dt>{t("undoArchivedLocation")}</dt>
                <dd>
                  <bdi>{failure.to}</bdi>
                </dd>
              </div>
            </dl>
            {locale === "en" && failure.message && <p className="filesystem-detail">{failure.message}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function App() {
  const [view, setView] = useState<View>("organize");
  const [locale, setLocale] = useState<Locale>(() =>
    navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en",
  );
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ruleDefaults, setRuleDefaults] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState("");
  const [savedDraft, setSavedDraft] = useState("");
  const [sourceDir, setSourceDir] = useState("");
  const [destDir, setDestDir] = useState("");
  const [folderValidated, setFolderValidated] = useState({ source: false, destination: false });
  const [inPlace, setInPlace] = useState(true);
  const [recursive, setRecursive] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedFile, setSelectedFile] = useState<PlanEntry | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [lastRunState, setLastRunState] = useState<"loading" | "error" | "empty" | "ready">("empty");
  const [lastRunError, setLastRunError] = useState("");
  const [runRefresh, setRunRefresh] = useState(0);
  const [confirmUndo, setConfirmUndo] = useState<LastRun | null>(null);
  const operation = useRef(false);
  const alive = useRef(true);
  const sourceInput = useRef<HTMLInputElement>(null);
  const destinationInput = useRef<HTMLInputElement>(null);
  const fileDetail = useRef<HTMLDivElement>(null);
  const destination = inPlace ? sourceDir : destDir;
  const sourceError = folderValidated.source && !sourceDir.trim();
  const destinationError = !inPlace && folderValidated.destination && !destDir.trim();
  const dirty = draft !== savedDraft;
  useEffect(() => protectUnsavedChanges(window, dirty), [dirty]);
  const ready = Boolean(window.tidy);
  const t = (key: MessageKey, values?: MessageValues) => translate(locale, key, values);
  const count = (value: number) => numberLabel(locale, value);

  useEffect(() => {
    alive.current = true;
    let current = true;
    if (!window.tidy) {
      setNotice({ tone: "error", key: "connectionError" });
      return () => {
        alive.current = false;
      };
    }
    window.tidy
      .getPreferences()
      .then((value) => {
        if (current) setLocale(value.locale);
      })
      .catch((error) => {
        if (current) setNotice({ tone: "error", detail: errorText(error) });
      });
    window.tidy
      .getDefaults()
      .then((value) => {
        if (current) setRuleDefaults(value);
      })
      .catch((error) => {
        if (current) setNotice({ tone: "error", detail: errorText(error) });
      });
    window.tidy
      .getSettings()
      .then((value) => {
        if (!current) return;
        setSettings(value);
        const text = configText(value.config);
        setDraft(text);
        setSavedDraft(text);
        if (typeof value.config.dest === "string") {
          setDestDir(value.config.dest);
          setInPlace(false);
        }
      })
      .catch((error) => {
        if (current) setNotice({ tone: "error", detail: errorText(error), key: "ruleRecovery" });
      });
    const unsubscribe = window.tidy.onProgress((value) => {
      if (alive.current) setProgress(value);
    });
    return () => {
      current = false;
      alive.current = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
  }, [locale]);
  useEffect(() => {
    setAnalysis(null);
    setSelectedFile(null);
    setPage(0);
    setConfirmUndo(null);
  }, [sourceDir, destDir, inPlace, recursive]);
  useEffect(() => {
    let current = true;
    setLastRun(null);
    setLastRunError("");
    setLastRunState(ready && destination ? "loading" : "empty");
    if (ready && destination && !busy)
      window.tidy
        .getLastRun(destination)
        .then((value) => {
          if (current) {
            setLastRun(value);
            setLastRunState(value ? "ready" : "empty");
          }
        })
        .catch((error) => {
          if (current) {
            setLastRunError(errorText(error));
            setLastRunState("error");
          }
        });
    return () => {
      current = false;
    };
  }, [destination, busy, ready, locale, runRefresh]);
  useEffect(() => {
    setPage(0);
  }, [filter, search]);
  useEffect(() => {
    if (!selectedFile) return;
    const revealDetail = () => fileDetail.current?.scrollIntoView({ block: "nearest" });
    revealDetail();
    window.addEventListener("resize", revealDetail);
    return () => window.removeEventListener("resize", revealDetail);
  }, [selectedFile, locale]);

  const categorySummaries = useMemo(() => getCategorySummaries(settings?.config ?? {}), [settings?.config]);
  const totalFormats = categorySummaries.reduce((sum, category) => sum + category.extensions.length, 0);
  const filtered = useMemo(
    () =>
      (analysis?.entries ?? []).filter(
        (entry) =>
          (filter === "all" || entry.action === filter) &&
          (!search || `${entry.name} ${entry.to}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [analysis, filter, search],
  );
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visiblePage = Math.min(page, totalPages - 1);
  const totalBytes = useMemo(() => (analysis?.entries ?? []).reduce((sum, entry) => sum + entry.size, 0), [analysis]);
  const similarCount = useMemo(
    () => (analysis?.entries ?? []).filter((entry) => entry.similar || entry.perceptual).length,
    [analysis],
  );
  const hasFiles = Boolean(analysis?.entries.length);
  const progressText = busy
    ? progress && busy === "analyze"
      ? t(phaseKeys[progress.phase] ?? "scanning")
      : t(busyKeys[busy])
    : t("readyStatus");

  async function run<T>(label: Busy, work: () => Promise<T>): Promise<T | undefined> {
    if (operation.current) return;
    operation.current = true;
    setBusy(label);
    setNotice(null);
    try {
      return await work();
    } catch (error) {
      if (alive.current) setNotice({ tone: "error", detail: errorText(error) });
    } finally {
      operation.current = false;
      if (alive.current) {
        setBusy(null);
        setProgress(null);
      }
    }
  }
  async function switchLanguage(next: Locale) {
    if (next === locale) return;
    await run("language", async () => {
      const value = await window.tidy.setLocale(next);
      if (alive.current) setLocale(value.locale);
    });
  }
  async function choose(kind: "source" | "destination") {
    await run("choose", async () => {
      const selected = await window.tidy.chooseDirectory();
      if (selected && alive.current) {
        (kind === "source" ? setSourceDir : setDestDir)(selected);
        setFolderValidated((current) => ({ ...current, [kind]: false }));
      }
    });
  }
  async function preview(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready || !settings || operation.current) return;
    const missingSource = !sourceDir.trim();
    const missingDestination = !inPlace && !destDir.trim();
    setFolderValidated({ source: true, destination: !inPlace });
    if (missingSource || missingDestination) {
      (missingSource ? sourceInput : destinationInput).current?.focus();
      return;
    }
    await run("analyze", async () => {
      setAnalysis(null);
      setSelectedFile(null);
      setConfirmUndo(null);
      const value = await window.tidy.analyze({ sourceDir, destDir: destination, inPlace, recursive });
      if (alive.current) {
        setAnalysis(value);
        setFilter("all");
        setSearch("");
        setPage(0);
      }
    });
  }
  async function execute() {
    if (!analysis) return;
    const planId = analysis.planId;
    await run("execute", async () => {
      setAnalysis(null);
      setSelectedFile(null);
      const result = await window.tidy.execute(planId);
      if (!alive.current) return;
      setActivity((items) => [
        {
          id: result.manifestPath,
          time: new Date().toISOString(),
          kind: "organized",
          count: result.moved,
          destination,
          manifestPath: result.manifestPath,
          similarReport: result.similarReport,
        },
        ...items,
      ]);
      setNotice(
        result.reportErrors.length
          ? { tone: "warning", key: "reportWarning", values: { count: result.reportErrors.length } }
          : { tone: "success", key: "organizedNotice", values: { count: count(result.moved) } },
      );
    });
  }
  async function openReport(reportId: string) {
    await run("report", () => window.tidy.openReport(reportId));
  }
  async function undo() {
    if (!confirmUndo) return;
    const manifestPath = confirmUndo.manifestPath;
    await run("undo", async () => {
      setConfirmUndo(null);
      setAnalysis(null);
      setSelectedFile(null);
      const result = await window.tidy.undo(destination, manifestPath);
      if (!alive.current) return;
      if (!result) {
        setNotice({ tone: "warning", key: "noRun" });
        return;
      }
      setActivity((items) => [
        {
          id: `${manifestPath}-undo-${Date.now()}`,
          time: new Date().toISOString(),
          kind: "restored",
          count: result.restored,
          destination,
          failures: result.failures,
          manifestPath,
        },
        ...items,
      ]);
      setNotice({
        tone: result.failures.length ? "warning" : "success",
        key: result.failures.length ? "restoreFailure" : "restoredNotice",
        values: { count: count(result.restored), failures: count(result.failures.length) },
      });
    });
  }
  async function saveRules() {
    await run("save", async () => {
      const value = await window.tidy.saveConfig(draft);
      if (!alive.current) return;
      setSettings(value);
      const text = configText(value.config);
      setDraft(text);
      setSavedDraft(text);
      setAnalysis(null);
      setSelectedFile(null);
      setNotice({ tone: "success", key: "rulesSaved" });
    });
  }
  async function defaults() {
    await run("defaults", async () => {
      const value = await window.tidy.getDefaults();
      if (alive.current) {
        setRuleDefaults(value);
        setDraft(configText(value));
        setNotice({ tone: "success", key: "defaultsLoaded" });
      }
    });
  }

  const pageTitles: Record<View, [MessageKey, MessageKey]> = {
    organize: ["organizeTitle", "organizeSubtitle"],
    rules: ["rulesTitle", "rulesSubtitle"],
    activity: ["activityTitle", "activitySubtitle"],
  };
  return (
    <div className={`app-shell ${navigator.userAgent.includes("Mac") ? "is-mac" : ""}`}>
      <header className="titlebar">
        <div className="traffic-space" aria-hidden="true" />
        <div className="app-brand">
          <img className="brand-icon" src={appIcon} alt="" />
          <span>File Tidy</span>
          <span className="app-version">{settings?.version ?? ""}</span>
        </div>
        <div className="titlebar-status">
          <span className="status-dot" />
          {t("local")}
        </div>
        <div className="language-switch" role="group" aria-label={t("language")}>
          <button
            type="button"
            lang="zh-CN"
            aria-pressed={locale === "zh-CN"}
            disabled={Boolean(busy) || !ready}
            onClick={() => switchLanguage("zh-CN")}
          >
            中文
          </button>
          <button
            type="button"
            lang="en"
            aria-pressed={locale === "en"}
            disabled={Boolean(busy) || !ready}
            onClick={() => switchLanguage("en")}
          >
            EN
          </button>
        </div>
      </header>
      <div className="view-header">
        <div className="page-heading">
          <h1>{t(pageTitles[view][0])}</h1>
          <p>{t(pageTitles[view][1])}</p>
        </div>
        <nav className="view-tabs" aria-label={t("organize")}>
          {(
            [
              { id: "organize", icon: "folder" },
              { id: "rules", icon: "rules" },
              { id: "activity", icon: "clock" },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              className="tab-button"
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <Icon name={item.icon} size={16} />
              <span>{t(item.id)}</span>
              {item.id === "rules" && dirty && <span className="unsaved-label">{t("unsaved")}</span>}
            </button>
          ))}
        </nav>
      </div>
      {notice && (
        <div className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <Icon name={notice.tone === "success" ? "check" : "shield"} size={16} />
          <div>
            {notice.detail && <span>{notice.detail} </span>}
            {notice.key && <span>{t(notice.key, notice.values)}</span>}
          </div>
          <button type="button" className="icon-button" aria-label={t("dismiss")} onClick={() => setNotice(null)}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      <main className="app-content">
        {view === "organize" && (
          <div className="workspace">
            <form
              className="setup-panel"
              onSubmit={preview}
              noValidate
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) {
                  event.preventDefault();
                }
              }}
            >
              <div className="panel-heading">
                <h2>{t("folderSetup")}</h2>
                <Icon name="folder" size={17} />
              </div>
              <fieldset className="setup-scroll" disabled={Boolean(busy) || !ready}>
                <div className="field-group">
                  <label className="field-label" htmlFor="source-folder">
                    {t("source")}
                  </label>
                  <div className={`folder-control ${sourceError ? "is-invalid" : ""}`}>
                    <input
                      id="source-folder"
                      ref={sourceInput}
                      className="folder-path"
                      value={sourceDir}
                      placeholder={t("sourcePlaceholder")}
                      onChange={(event) => setSourceDir(event.target.value)}
                      required
                      aria-invalid={sourceError || undefined}
                      aria-describedby={sourceError ? "source-folder-error" : undefined}
                      spellCheck={false}
                      dir="auto"
                      title={sourceDir}
                    />
                    <button type="button" className="browse-button" onClick={() => choose("source")}>
                      {t("browse")}
                    </button>
                  </div>
                  {sourceError && (
                    <p className="field-error" id="source-folder-error" role="alert">
                      {t("sourceRequired")}
                    </p>
                  )}
                  {sourceDir && (
                    <span className="folder-meta">
                      <Icon name="folder" size={12} />
                      <bdi>{basename(sourceDir)}</bdi>
                    </span>
                  )}
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor="destination-folder">
                    {t("destination")}
                  </label>
                  <div
                    className={`folder-control ${inPlace ? "is-muted" : ""} ${destinationError ? "is-invalid" : ""}`}
                  >
                    <input
                      id="destination-folder"
                      ref={destinationInput}
                      className="folder-path"
                      value={inPlace ? sourceDir : destDir}
                      placeholder={inPlace ? t("destinationInPlace") : t("destinationPlaceholder")}
                      onChange={(event) => setDestDir(event.target.value)}
                      disabled={inPlace}
                      required={!inPlace}
                      aria-invalid={destinationError || undefined}
                      aria-describedby={destinationError ? "destination-folder-error" : undefined}
                      spellCheck={false}
                      dir="auto"
                      title={destination}
                    />
                    {!inPlace && (
                      <button type="button" className="browse-button" onClick={() => choose("destination")}>
                        {t("browse")}
                      </button>
                    )}
                  </div>
                  {destinationError && (
                    <p className="field-error" id="destination-folder-error" role="alert">
                      {t("destinationRequired")}
                    </p>
                  )}
                </div>
                <section className="setup-section">
                  <h3>{t("folderOptions")}</h3>
                  <label className="option-row">
                    <span>
                      <strong>{t("inPlace")}</strong>
                      <small>{t("inPlaceHelp")}</small>
                    </span>
                    <input
                      className="toggle-input"
                      type="checkbox"
                      checked={inPlace}
                      onChange={(event) => {
                        setInPlace(event.target.checked);
                        setFolderValidated((current) => ({ ...current, destination: false }));
                      }}
                    />
                  </label>
                  <label className="option-row">
                    <span>
                      <strong>{t("recursive")}</strong>
                      <small>{t("recursiveHelp")}</small>
                    </span>
                    <input
                      className="toggle-input"
                      type="checkbox"
                      checked={recursive}
                      onChange={(event) => setRecursive(event.target.checked)}
                    />
                  </label>
                </section>
                <section className="setup-section rule-summary">
                  <div className="rule-summary-heading">
                    <h3>{t("currentRules")}</h3>
                    <button type="button" className="rule-link" onClick={() => setView("rules")}>
                      {t("editRules")}
                    </button>
                  </div>
                  <ul className="rule-list">
                    {categorySummaries.map((category) => {
                      const details = [
                        category.groupBy.map((field) => t(field as MessageKey)).join(" / "),
                        category.granularity === "month"
                          ? t("summaryMonth")
                          : category.granularity === "year"
                            ? t("summaryYear")
                            : "",
                        category.subRuleCount ? t("summarySubRules", { count: category.subRuleCount }) : "",
                      ].filter(Boolean);
                      return (
                        <li className="rule-line" key={category.name}>
                          <span
                            className={`rule-dot tone-${Object.hasOwn(categoryColors, category.name) ? categoryColors[category.name] : "gray"}`}
                            aria-hidden="true"
                          />
                          <span className="rule-category">
                            <span>
                              <bdi>{categoryLabel(locale, category.name)}</bdi>
                            </span>
                            <small>
                              {details.join(" · ") || t(category.isFallback ? "fallback" : "summaryByType")}
                            </small>
                          </span>
                          <span
                            className="rule-count"
                            aria-label={
                              category.isFallback ? t("fallback") : t("formats", { count: category.extensions.length })
                            }
                          >
                            {category.isFallback ? ruleText(locale, "fallbackNav") : count(category.extensions.length)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="rules-overview">
                    {t("categories", { count: count(categorySummaries.length) })}
                    <span> · </span>
                    {t("formats", { count: count(totalFormats) })}
                  </p>
                  {Object.keys((settings?.config.extensions ?? {}) as Record<string, unknown>).length > 0 && (
                    <p className="rules-overview">{ruleText(locale, "formatsHint")}</p>
                  )}
                </section>
              </fieldset>
              <div className="setup-footer">
                <button className="button button-primary" type="submit" disabled={Boolean(busy) || !ready || !settings}>
                  {busy === "analyze" ? t("scanning") : analysis ? t("rescan") : t("scan")}
                </button>
                <p>
                  <Icon name="shield" size={13} />
                  {t("previewReadOnly")}
                </p>
              </div>
            </form>
            <section className="preview-panel" aria-labelledby="preview-title">
              <div className="preview-heading">
                <div>
                  <h2 id="preview-title">{t("preview")}</h2>
                  <p>
                    {analysis
                      ? `${t("totalFiles", { count: count(analysis.entries.length) })} · ${fileSize(locale, totalBytes)}`
                      : t("previewCaption")}
                  </p>
                </div>
                <span className="preview-state">
                  {busy === "analyze" ? (
                    <>
                      <span className="loading-dot" />
                      {progressText}
                    </>
                  ) : (
                    <>
                      <Icon name="shield" size={14} />
                      {t("localStatus")}
                    </>
                  )}
                </span>
              </div>
              <div className="preview-tools">
                <div className="filter-tabs" role="group" aria-label={t("action")}>
                  {(
                    [
                      { value: "all", key: "all" },
                      { value: "archive", key: "archive" },
                      { value: "duplicate", key: "duplicates" },
                      { value: "review", key: "needsReview" },
                    ] as const
                  ).map((item) => (
                    <button
                      type="button"
                      key={item.value}
                      aria-pressed={filter === item.value}
                      disabled={!hasFiles}
                      onClick={() => setFilter(item.value)}
                    >
                      {t(item.key)}
                      {analysis && (
                        <span>
                          {count(item.value === "all" ? analysis.entries.length : analysis.counts[item.value])}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <label className="search-input">
                  <Icon name="search" size={15} />
                  <span className="sr-only">{t("search")}</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("searchPlaceholder")}
                    disabled={!hasFiles}
                  />
                </label>
              </div>
              {analysis && hasFiles && (
                <div className="preview-summary">
                  <span className="summary-chip archive-chip">
                    {t("archiveCount", { count: count(analysis.counts.archive) })}
                  </span>
                  {analysis.counts.duplicate > 0 && (
                    <span className="summary-chip duplicate-chip">
                      {t("duplicateCount", { count: count(analysis.counts.duplicate) })}
                    </span>
                  )}
                  {analysis.counts.review > 0 && (
                    <span className="summary-chip review-chip">
                      {t("reviewCount", { count: count(analysis.counts.review) })}
                    </span>
                  )}
                </div>
              )}
              {similarCount > 0 && (
                <p className="preview-advisory">{t("similarNotice", { count: count(similarCount) })}</p>
              )}
              {hasFiles ? (
                <div className="preview-results">
                  <div className="table-scroll">
                    <table className="file-table">
                      <thead>
                        <tr>
                          <th scope="col">{t("file")}</th>
                          <th scope="col">{t("target")}</th>
                          <th scope="col">{t("action")}</th>
                          <th scope="col" className="size-cell">
                            {t("size")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map((entry) => (
                          <tr key={entry.from} className={selectedFile?.from === entry.from ? "is-selected" : ""}>
                            <td>
                              <div className="file-copy">
                                <span className={`file-icon tone-${categoryColors[entry.category ?? ""] ?? "gray"}`}>
                                  <Icon
                                    name={
                                      entry.category === "Audios"
                                        ? "music"
                                        : entry.category === "Images"
                                          ? "image"
                                          : "file"
                                    }
                                    size={18}
                                  />
                                </span>
                                <div>
                                  <button
                                    type="button"
                                    className="file-name"
                                    title={entry.from}
                                    onClick={() => setSelectedFile(selectedFile?.from === entry.from ? null : entry)}
                                  >
                                    <bdi>{entry.name}</bdi>
                                  </button>
                                  <span className="file-subtitle">
                                    {explanation(entry)
                                      ? t(explanation(entry)!)
                                      : entry.category
                                        ? categoryLabel(locale, entry.category)
                                        : t(entry.action === "duplicate" ? "duplicates" : "needsReview")}
                                    {(Boolean(entry.similar) || Boolean(entry.perceptual)) && ` · ${t("similarFlag")}`}
                                  </span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="destination-path" dir="auto" title={entry.to}>
                                {relativePath(entry, analysis?.destDir ?? destination)}
                              </span>
                            </td>
                            <td>
                              <span className={`action-badge action-${entry.action}`}>{t(entry.action)}</span>
                            </td>
                            <td className="size-cell">{fileSize(locale, entry.size)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <div className="table-empty">
                        <Icon name="search" size={26} />
                        <h3>{t("noResults")}</h3>
                        <p>{t("noResultsDescription")}</p>
                      </div>
                    )}
                  </div>
                  {selectedFile && (
                    <div className="file-detail" ref={fileDetail}>
                      <Icon name="file" size={17} />
                      <dl>
                        <div>
                          <dt>{t("currentLocation")}</dt>
                          <dd>
                            <bdi>{selectedFile.from}</bdi>
                          </dd>
                        </div>
                        <div>
                          <dt>{t("target")}</dt>
                          <dd>
                            <bdi>{selectedFile.to}</bdi>
                          </dd>
                        </div>
                        {explanation(selectedFile) && (
                          <div>
                            <dt>{t("classificationReason")}</dt>
                            <dd>
                              {t(explanation(selectedFile)!)}
                              {selectedFile.issueDetail && ` (${selectedFile.issueDetail})`}
                            </dd>
                          </div>
                        )}
                        {selectedFile.metadata &&
                          Object.entries(selectedFile.metadata).map(([field, value]) => (
                            <div key={field}>
                              <dt>{t(field as MessageKey)}</dt>
                              <dd>
                                <bdi>{value}</bdi>
                              </dd>
                            </div>
                          ))}
                        {(selectedFile.similar || selectedFile.perceptual) && (
                          <div>
                            <dt>{t("similarFiles")}</dt>
                            <dd>
                              <SimilarDetails entry={selectedFile} locale={locale} />
                            </dd>
                          </div>
                        )}
                      </dl>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t("dismiss")}
                        onClick={() => setSelectedFile(null)}
                      >
                        <Icon name="close" size={15} />
                      </button>
                    </div>
                  )}
                  <div className="preview-footer">
                    <span>
                      {t("range", {
                        start: filtered.length ? count(visiblePage * pageSize + 1) : "0",
                        end: count(Math.min((visiblePage + 1) * pageSize, filtered.length)),
                        total: count(filtered.length),
                      })}
                    </span>
                    {totalPages > 1 && (
                      <div className="pagination">
                        <button type="button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>
                          {t("previous")}
                        </button>
                        <span>{t("page", { current: count(visiblePage + 1), total: count(totalPages) })}</span>
                        <button
                          type="button"
                          disabled={visiblePage + 1 >= totalPages}
                          onClick={() => setPage(visiblePage + 1)}
                        >
                          {t("next")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className={`empty-preview ${busy === "analyze" ? "is-loading" : ""}`}>
                  <div className="empty-glyph">
                    <Icon name={busy === "analyze" ? "search" : analysis ? "check" : "stack"} size={36} />
                  </div>
                  <div className="empty-copy">
                    <h3>
                      {busy === "analyze"
                        ? progressText
                        : t(analysis ? "cleanTitle" : sourceDir ? "readyTitle" : "noFolderTitle")}
                    </h3>
                    <p>
                      {busy === "analyze"
                        ? progress?.done !== undefined
                          ? t("phaseProgress", { done: count(progress.done), total: count(progress.files ?? 0) })
                          : t("previewReadOnly")
                        : t(analysis ? "cleanDescription" : sourceDir ? "readyDescription" : "noFolderDescription")}
                    </p>
                  </div>
                  <div className="empty-tips">
                    {(["emptyFeature1", "emptyFeature2", "emptyFeature3"] as const).map((key) => (
                      <span key={key}>
                        <Icon name="check" size={13} />
                        {t(key)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="execution-bar">
                <div>
                  <Icon name="shield" size={16} />
                  <span>{hasFiles ? t("executeHelp") : t("safety")}</span>
                </div>
                <button
                  type="button"
                  className="button button-primary"
                  disabled={Boolean(busy) || !hasFiles}
                  onClick={execute}
                >
                  {busy === "execute" ? t("executing") : t("execute", { count: count(analysis?.entries.length ?? 0) })}
                </button>
              </div>
            </section>
          </div>
        )}
        <RulesView
          hidden={view !== "rules"}
          locale={locale}
          config={settings?.config ?? null}
          defaults={ruleDefaults}
          draft={draft}
          setDraft={setDraft}
          busy={Boolean(busy) || !ready || view !== "rules"}
          onSave={saveRules}
          onDefaults={defaults}
          onDiscard={() => setDraft(savedDraft)}
        />
        {view === "activity" && (
          <div className="activity-layout">
            <section className="last-run-panel" data-testid="run-load-state" data-state={lastRunState}>
              <div className="panel-heading">
                <h2>{t("savedRun")}</h2>
                <Icon name="clock" size={17} />
              </div>
              {lastRunState === "ready" && lastRun ? (
                <div className="last-run-content">
                  <div className="run-folder">
                    <span className="file-icon tone-blue">
                      <Icon name="folder" size={24} />
                    </span>
                    <div>
                      <h3>
                        <bdi>{basename(destination)}</bdi>
                      </h3>
                      <p className="destination-path">
                        <bdi>{destination}</bdi>
                      </p>
                    </div>
                  </div>
                  <dl className="run-facts">
                    <div>
                      <dt>{t("recordedFiles", { count: count(lastRun.moves) })}</dt>
                      <dd>{dateLabel(locale, lastRun.time)}</dd>
                    </div>
                    <div>
                      <dt>{t("originalFolder")}</dt>
                      <dd dir="auto">{lastRun.sourceDir}</dd>
                    </div>
                  </dl>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={Boolean(busy)}
                    onClick={() => setConfirmUndo(lastRun)}
                  >
                    {t("undo")}
                  </button>
                </div>
              ) : lastRunState === "loading" ? (
                <div className="activity-empty" role="status" data-testid="run-loading">
                  <span className="loading-dot" />
                  <p>{t("runLoading")}</p>
                </div>
              ) : lastRunState === "error" ? (
                <div className="activity-empty activity-load-error" data-testid="run-load-error" role="alert">
                  <Icon name="shield" size={28} />
                  <h3>{t("runLoadError")}</h3>
                  <p>{lastRunError}</p>
                  <button
                    type="button"
                    className="button button-secondary"
                    data-testid="run-load-retry"
                    disabled={Boolean(busy)}
                    onClick={() => setRunRefresh((value) => value + 1)}
                  >
                    {t("retry")}
                  </button>
                </div>
              ) : (
                <div className="activity-empty" data-testid="run-empty">
                  <Icon name="clock" size={28} />
                  <h3>{t("noRunTitle")}</h3>
                  <p>{t("noRunDescription")}</p>
                  <button type="button" className="button button-secondary" onClick={() => setView("organize")}>
                    {t("openOrganize")}
                  </button>
                </div>
              )}
              {confirmUndo && (
                <div className="undo-confirmation" role="group" aria-label={t("confirmUndo")}>
                  <h3>{t("confirmUndo")}</h3>
                  <time>{dateLabel(locale, confirmUndo.time)}</time>
                  <p>{t("confirmUndoDescription")}</p>
                  <div>
                    <button
                      type="button"
                      className="button button-quiet"
                      disabled={Boolean(busy)}
                      onClick={() => setConfirmUndo(null)}
                    >
                      {t("keepOrganized")}
                    </button>
                    <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={undo}>
                      {t("restore")}
                    </button>
                  </div>
                </div>
              )}
            </section>
            <section className="run-list">
              <div className="panel-heading">
                <h2>{t("session")}</h2>
                <span>{count(activity.length)}</span>
              </div>
              {activity.length ? (
                <ol>
                  {activity.map((item) => (
                    <li className="run-row" key={item.id}>
                      <span className={`file-icon ${item.kind === "organized" ? "tone-teal" : "tone-blue"}`}>
                        <Icon name={item.kind === "organized" ? "check" : "clock"} size={18} />
                      </span>
                      <div>
                        <h3>
                          {t(item.kind === "organized" ? "organizedAction" : "restoredAction", {
                            count: count(item.count),
                          })}
                        </h3>
                        <p>
                          <bdi>{item.destination}</bdi>
                        </p>
                        {item.manifestPath && (
                          <p className="run-manifest">
                            <span>{t("reportFile")}: </span>
                            <bdi>{item.manifestPath}</bdi>
                          </p>
                        )}
                        {item.similarReport && (
                          <div className="activity-report">
                            <p className="run-manifest">
                              <span>{t("similarReport")}: </span>
                              <bdi>{item.similarReport.path}</bdi>
                            </p>
                            <button
                              type="button"
                              className="button button-secondary"
                              data-testid="open-similar-report"
                              disabled={Boolean(busy)}
                              onClick={() => openReport(item.similarReport!.id)}
                            >
                              {t("openSimilarReport")}
                            </button>
                          </div>
                        )}
                        {item.failures?.length ? (
                          <>
                            <p>
                              {t("restoreFailure", { count: count(item.count), failures: count(item.failures.length) })}
                            </p>
                            <UndoFailures failures={item.failures} locale={locale} />
                            {lastRun?.manifestPath === item.manifestPath && (
                              <button
                                type="button"
                                className="button button-secondary"
                                data-testid="undo-retry"
                                disabled={Boolean(busy)}
                                onClick={() => setConfirmUndo(lastRun)}
                              >
                                {t("undoRetry")}
                              </button>
                            )}
                          </>
                        ) : null}
                        <time>{dateLabel(locale, item.time)}</time>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="activity-empty">
                  <Icon name="stack" size={28} />
                  <h3>{t("noActivity")}</h3>
                  <p>{t("noActivityDescription")}</p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
      <footer className="statusbar">
        <span>
          <span className={busy ? "loading-dot" : "status-dot"} />
          {progressText}
        </span>
        <span>
          {busy && progress?.done !== undefined
            ? t("phaseProgress", { done: count(progress.done), total: count(progress.files ?? 0) })
            : t("hiddenSkipped")}
        </span>
        <span>
          <Icon name="shield" size={12} />
          {t("localStatus")}
        </span>
      </footer>
    </div>
  );
}
