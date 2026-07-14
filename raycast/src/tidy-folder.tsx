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
import { useState } from "react";
import { buildExtIndex, isInsideDir, loadConfig } from "file-tidy/src/config.js";
import { findDuplicates } from "file-tidy/src/dedup.js";
import { executePlan } from "file-tidy/src/execute.js";
import { buildPlan, formatSize, type PlanEntry } from "file-tidy/src/plan.js";
import { scanDest, scanSource } from "file-tidy/src/scan.js";

interface Preferences {
  defaultDest?: string;
}

interface FormValues {
  source: string[];
  dest: string[];
  inPlace: boolean;
  recursive: boolean;
}

export default function TidyFolderCommand() {
  const { push } = useNavigation();
  const { defaultDest } = getPreferenceValues<Preferences>();
  const [sourceError, setSourceError] = useState<string | undefined>();
  const [destError, setDestError] = useState<string | undefined>();
  const [inPlace, setInPlace] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(values: FormValues) {
    const sourceDir = values.source[0];
    if (!sourceDir) {
      setSourceError("请选择要整理的文件夹");
      return;
    }
    const destDir = values.inPlace ? sourceDir : (values.dest[0] ?? defaultDest);
    if (!destDir) {
      setDestError("请选择归档目录，或在扩展设置里配置默认归档目录");
      return;
    }
    if (!values.inPlace && isInsideDir(sourceDir, destDir)) {
      setDestError("归档目录不能在源文件夹内部；想在源文件夹内整理请勾选「就地整理」");
      return;
    }

    setLoading(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "扫描中…" });
    try {
      const config = loadConfig();
      const organizedDirs = new Set([...Object.keys(config.categories), config.fallbackCategory, "Duplicates"]);
      const sourceFiles = scanSource(sourceDir, {
        recursive: values.recursive,
        excludeTopDirs: values.inPlace ? organizedDirs : undefined,
      });
      if (!sourceFiles.length) {
        toast.style = Toast.Style.Failure;
        toast.title = "没有需要整理的文件";
        toast.message = "隐藏文件和子文件夹会被跳过，需要递归请勾选「递归整理」";
        return;
      }
      const destFiles = scanDest(destDir, values.inPlace ? { onlyDirs: organizedDirs } : undefined);
      const duplicates = await findDuplicates(sourceFiles, destFiles);
      const entries = await buildPlan({
        sourceFiles,
        duplicates,
        destDir,
        extIndex: buildExtIndex(config),
        fallbackCategory: config.fallbackCategory,
      });
      await toast.hide();
      push(<PlanView entries={entries} sourceDir={sourceDir} destDir={destDir} />);
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "扫描失败";
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
          <Action.SubmitForm title="预览整理计划" icon={Icon.MagnifyingGlass} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="source"
        title="要整理的文件夹"
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
        error={sourceError}
        onChange={() => setSourceError(undefined)}
      />
      <Form.Checkbox
        id="inPlace"
        label="就地整理（分类目录直接建在源文件夹内）"
        value={inPlace}
        onChange={setInPlace}
      />
      {!inPlace && (
        <Form.FilePicker
          id="dest"
          title="归档目录"
          allowMultipleSelection={false}
          canChooseDirectories
          canChooseFiles={false}
          info={defaultDest ? `留空则使用默认归档目录：${defaultDest}` : "留空则使用扩展设置里的默认归档目录（当前未配置）"}
          error={destError}
          onChange={() => setDestError(undefined)}
        />
      )}
      <Form.Checkbox id="recursive" label="递归整理子文件夹" defaultValue={false} />
      <Form.Description text="提交后会先显示整理计划，确认后才会移动文件。" />
    </Form>
  );
}

function PlanView({ entries, sourceDir, destDir }: { entries: PlanEntry[]; sourceDir: string; destDir: string }) {
  const archives = entries.filter((e) => e.action === "archive");
  const dups = entries.filter((e) => e.action === "duplicate");

  const byBucket = new Map<string, PlanEntry[]>();
  for (const e of archives) {
    const bucket = `${e.category}/${e.yearMonth}`;
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), e]);
  }

  async function execute() {
    const destMissing = !fs.existsSync(destDir);
    const ok = await confirmAlert({
      title: destMissing ? "新建归档目录并执行整理？" : "确认执行整理？",
      message:
        `${destMissing ? `目标目录 ${destDir} 不存在，将会新建。\n` : ""}` +
        `归档 ${archives.length} 个文件，隔离重复 ${dups.length} 个 → ${destDir}`,
      primaryAction: { title: "执行", style: Alert.ActionStyle.Default },
    });
    if (!ok) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: "整理中…" });
    try {
      const { moved } = executePlan(entries, { destDir, sourceDir });
      const dupCount = moved.filter((e) => e.action === "duplicate").length;
      toast.style = Toast.Style.Success;
      toast.title = `完成：归档 ${moved.length - dupCount} 个，隔离重复 ${dupCount} 个`;
      toast.message = "可用「Undo Last Tidy」撤销";
      toast.primaryAction = {
        title: "打开归档目录",
        onAction: () => open(destDir),
      };
      await popToRoot();
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "整理失败";
      toast.message = err instanceof Error ? err.message : String(err);
    }
  }

  const executeAction = (
    <ActionPanel>
      <Action title="执行整理" icon={Icon.Checkmark} onAction={execute} />
      <Action.ShowInFinder title="在文件管理器中显示源文件夹" path={sourceDir} />
    </ActionPanel>
  );

  return (
    <List navigationTitle={`整理计划 → ${destDir}（共 ${entries.length} 个文件）`}>
      {[...byBucket.keys()].sort().map((bucket) => (
        <List.Section key={bucket} title={bucket} subtitle={`${byBucket.get(bucket)!.length} 个`}>
          {byBucket.get(bucket)!.map((e) => (
            <List.Item
              key={e.from}
              title={e.name}
              icon={Icon.Document}
              accessories={[
                { text: formatSize(e.size) },
                {
                  tag:
                    e.dateSource === "exif"
                      ? { value: "EXIF", color: Color.Green }
                      : { value: "文件日期", color: Color.SecondaryText },
                },
              ]}
              actions={executeAction}
            />
          ))}
        </List.Section>
      ))}
      {dups.length > 0 && (
        <List.Section title="Duplicates（重复文件，移入隔离区）" subtitle={`${dups.length} 个`}>
          {dups.map((e) => (
            <List.Item
              key={e.from}
              title={e.name}
              subtitle={`与之相同: ${e.keeperPath}`}
              icon={{ source: Icon.Duplicate, tintColor: Color.Magenta }}
              accessories={[{ text: formatSize(e.size) }]}
              actions={executeAction}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
