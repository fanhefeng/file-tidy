import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Form,
  Icon,
  List,
  Toast,
  confirmAlert,
  getPreferenceValues,
  open,
  popToRoot,
  showToast,
  useNavigation,
} from "@raycast/api";
import fs from "node:fs";
import path from "node:path";
import { useState } from "react";
import { analyze, type AnalyzeCounts, type Phase } from "./core/analyze.js";
import { canonicalPath, isInsideDir, loadConfig } from "./core/config.js";
import { executePlan } from "./core/execute.js";
import { bucketLabel, formatSize, type PlanEntry } from "./core/plan.js";

interface FormValues {
  source: string[];
  dest: string[];
  inPlace: boolean;
  recursive: boolean;
  smart: boolean;
}

// ---------- English copy (core returns data and codes only) ----------

const PHASE_TEXT: Partial<Record<Phase, string | ((info: { files?: number; done?: number }) => string)>> = {
  scanning: "Scanning…",
  dedup: ({ files }) => `Checking ${files} files for exact duplicates…`,
  health: "Looking for broken files and OS junk…",
  similar: "Looking for near-duplicates…",
  perceptual: ({ files, done }) => (done ? `Comparing images (${done}/${files})…` : "Comparing images…"),
  planning: "Building the plan…",
};

const ISSUE_TEXT: Record<string, string> = {
  empty: "zero-byte file",
  corrupt: "content doesn't match the extension",
  junk: "OS junk file",
};

const SIMILAR_TEXT: Record<string, string> = {
  versioned: "another version of the same release",
  "normalized-name": "the same thing under a different name",
  "same-stem": "the same name in another format",
};

export default function TidyFolderCommand() {
  const { push } = useNavigation();
  const { defaultDest } = getPreferenceValues<Preferences.TidyFolder>();
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [destError, setDestError] = useState<string | undefined>();
  const [inPlace, setInPlace] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(values: FormValues) {
    const pickedSource = values.source[0];
    if (!pickedSource) {
      setSourceError("Pick a folder to tidy");
      return;
    }
    const pickedDest = values.inPlace ? pickedSource : (values.dest[0] ?? defaultDest);
    if (!pickedDest) {
      setDestError("Pick a destination folder, or set a default one in the extension preferences");
      return;
    }
    // Canonicalize before the containment check so symlinked or differently
    // spelled paths (e.g. /var vs /private/var) can't sneak past it.
    const sourceDir = canonicalPath(pickedSource);
    const destDir = canonicalPath(pickedDest);
    if (!values.inPlace && (isInsideDir(sourceDir, destDir) || isInsideDir(destDir, sourceDir))) {
      setDestError("Source and destination can't contain each other; enable “Tidy in place” instead");
      return;
    }

    setLoading(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Scanning…" });
    try {
      const config = loadConfig();
      if (config._staleCategories?.length) {
        await showToast({
          style: Toast.Style.Failure,
          title: `Config is missing newer categories: ${config._staleCategories.join(", ")}`,
          message: `Those files will land in ${config.fallbackCategory}. Add them in ${config._path} to enable.`,
        });
      }
      if (!values.smart) config.detect = { similar: false, health: false, perceptual: false };
      const { entries, sourceFiles, counts } = await analyze({
        sourceDir,
        destDir,
        config,
        recursive: values.recursive,
        inPlace: values.inPlace,
        onPhase: (phase: Phase, info) => {
          const text = PHASE_TEXT[phase];
          if (text) toast.title = typeof text === "function" ? text(info ?? {}) : text;
        },
      });
      if (!sourceFiles.length) {
        toast.style = Toast.Style.Failure;
        toast.title = "Nothing to tidy";
        toast.message = "Hidden files and subfolders are skipped; enable “Include subfolders” to recurse";
        return;
      }
      await toast.hide();
      push(<PlanView entries={entries} counts={counts} sourceDir={sourceDir} destDir={destDir} />);
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Scan failed";
      toast.message = err instanceof Error ? err.message : String(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Form
      isLoading={loading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Preview Tidy Plan" icon={Icon.MagnifyingGlass} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="source"
        title="Folder to Tidy"
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
        error={sourceError}
        onChange={() => setSourceError(undefined)}
      />
      <Form.Checkbox
        id="inPlace"
        label="Tidy in place (create category folders inside the source folder)"
        value={inPlace}
        onChange={setInPlace}
      />
      {!inPlace && (
        <Form.FilePicker
          id="dest"
          title="Destination"
          allowMultipleSelection={false}
          canChooseDirectories
          canChooseFiles={false}
          info={
            defaultDest
              ? `Leave empty to use the default destination: ${defaultDest}`
              : "Leave empty to use the default destination from preferences (not set yet)"
          }
          error={destError}
          onChange={() => setDestError(undefined)}
        />
      )}
      <Form.Checkbox id="recursive" label="Include subfolders" defaultValue={false} />
      <Form.Checkbox
        id="smart"
        label="Smart checks (near-duplicates, broken files, visually similar images)"
        defaultValue={true}
        info="Near-duplicates and similar images are only flagged in the plan — they're still archived normally. Broken files and OS junk are moved to a review folder."
      />
      <Form.Description text="You'll see the full plan first — nothing moves until you confirm." />
    </Form>
  );
}

function PlanView({
  entries,
  counts,
  sourceDir,
  destDir,
}: {
  entries: PlanEntry[];
  counts: AnalyzeCounts;
  sourceDir: string;
  destDir: string;
}) {
  const archives = entries.filter((e) => e.action === "archive");
  const dups = entries.filter((e) => e.action === "duplicate");
  const reviews = entries.filter((e) => e.action === "review");

  const byBucket = new Map<string, PlanEntry[]>();
  for (const e of archives) {
    const bucket = bucketLabel(e, destDir);
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), e]);
  }

  async function execute() {
    const destMissing = !fs.existsSync(destDir);
    const ok = await confirmAlert({
      title: destMissing ? "Create destination and tidy?" : "Run this tidy plan?",
      message:
        `${destMissing ? `Destination ${destDir} doesn't exist and will be created.\n` : ""}` +
        `Archive ${archives.length} files, quarantine ${dups.length} duplicates, ` +
        `move ${reviews.length} to review → ${destDir}`,
      primaryAction: { title: "Tidy", style: Alert.ActionStyle.Default },
    });
    if (!ok) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: "Tidying…" });
    try {
      const { moved } = executePlan(entries, { destDir, sourceDir });
      const dupCount = moved.filter((e) => e.action === "duplicate").length;
      const reviewCount = moved.filter((e) => e.action === "review").length;
      toast.style = Toast.Style.Success;
      toast.title =
        `Done: ${moved.length - dupCount - reviewCount} archived, ` +
        `${dupCount} duplicates, ${reviewCount} to review`;
      toast.message = "Use “Undo Last Tidy” to revert";
      toast.primaryAction = {
        title: "Open Destination",
        onAction: () => open(destDir),
      };
      await popToRoot();
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "Tidy failed";
      toast.message = err instanceof Error ? err.message : String(err);
    }
  }

  const executeAction = (
    <ActionPanel>
      <Action title="Run Tidy Plan" icon={Icon.Checkmark} onAction={execute} />
      <Action.ShowInFinder title="Show Source Folder" path={sourceDir} />
    </ActionPanel>
  );

  /** Advisory flags — these never changed where the file goes. */
  function annotations(e: PlanEntry) {
    const out: string[] = [];
    if (e.similar) {
      const peers = e.similar.peers.map((p) => path.basename(p)).join(", ");
      out.push(`${SIMILAR_TEXT[e.similar.reason] ?? e.similar.reason}: ${peers}`);
    }
    if (e.perceptual) {
      const peers = e.perceptual.peers.map((p) => path.basename(p)).join(", ");
      out.push(`looks nearly identical to ${peers}`);
    }
    return out;
  }

  const smartSummary = [
    counts.similar ? `${counts.similar} near-duplicate` : null,
    counts.perceptual ? `${counts.perceptual} visually similar` : null,
  ].filter(Boolean);

  return (
    <List
      navigationTitle={`Tidy Plan → ${destDir} (${entries.length} files)`}
      searchBarPlaceholder={
        smartSummary.length ? `Flagged: ${smartSummary.join(", ")} — still archived normally` : "Filter files…"
      }
    >
      {[...byBucket.keys()].sort().map((bucket) => (
        <List.Section key={bucket} title={bucket} subtitle={`${byBucket.get(bucket)!.length} files`}>
          {byBucket.get(bucket)!.map((e) => {
            const notes = annotations(e);
            return (
              <List.Item
                key={e.from}
                title={e.name}
                subtitle={notes.join(" · ")}
                icon={Icon.Document}
                accessories={[
                  ...(notes.length ? [{ tag: { value: "flagged", color: Color.Orange } }] : []),
                  { text: formatSize(e.size) },
                  ...(e.dateBucket
                    ? [
                        {
                          tag:
                            e.dateSource === "exif"
                              ? { value: "EXIF", color: Color.Green }
                              : { value: "file date", color: Color.SecondaryText },
                        },
                      ]
                    : []),
                ]}
                actions={executeAction}
              />
            );
          })}
        </List.Section>
      ))}
      {dups.length > 0 && (
        <List.Section title="Exact duplicates (quarantined)" subtitle={`${dups.length} files`}>
          {dups.map((e) => (
            <List.Item
              key={e.from}
              title={e.name}
              subtitle={`identical to ${e.keeperPath}`}
              icon={{ source: Icon.Duplicate, tintColor: Color.Magenta }}
              accessories={[{ text: formatSize(e.size) }]}
              actions={executeAction}
            />
          ))}
        </List.Section>
      )}
      {reviews.length > 0 && (
        <List.Section title="Needs review (moved, never deleted)" subtitle={`${reviews.length} files`}>
          {reviews.map((e) => (
            <List.Item
              key={e.from}
              title={e.name}
              subtitle={ISSUE_TEXT[e.issue ?? ""] + (e.issue === "corrupt" ? ` (claims to be .${e.issueDetail})` : "")}
              icon={{ source: Icon.ExclamationMark, tintColor: Color.Red }}
              accessories={[{ text: formatSize(e.size) }]}
              actions={executeAction}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
