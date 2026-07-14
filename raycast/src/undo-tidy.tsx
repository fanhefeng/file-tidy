import {
  Action,
  ActionPanel,
  Alert,
  Form,
  Icon,
  Toast,
  confirmAlert,
  getPreferenceValues,
  popToRoot,
  showToast,
} from "@raycast/api";
import fs from "node:fs";
import path from "node:path";
import { useState } from "react";
import { undoLastRun } from "file-tidy/src/undo.js";

interface Preferences {
  defaultDest?: string;
}

export default function UndoTidyCommand() {
  const { defaultDest } = getPreferenceValues<Preferences>();
  const [destError, setDestError] = useState<string | undefined>();

  async function handleSubmit(values: { dest: string[] }) {
    const destDir = values.dest[0] ?? defaultDest;
    if (!destDir) {
      setDestError("请选择上次整理的归档目录");
      return;
    }
    const runsDir = path.join(destDir, ".tidy", "runs");
    const runs = fs.existsSync(runsDir)
      ? fs
          .readdirSync(runsDir)
          .filter((f) => f.endsWith(".json"))
          .sort()
      : [];
    if (!runs.length) {
      await showToast({
        style: Toast.Style.Failure,
        title: "没有可撤销的整理记录",
        message: `${destDir} 下没有 .tidy/runs 记录（就地整理请选源文件夹本身）`,
      });
      return;
    }

    const latestPath = path.join(runsDir, runs.at(-1)!);
    const { moves, time, sourceDir } = JSON.parse(fs.readFileSync(latestPath, "utf8")) as {
      moves: unknown[];
      time: string;
      sourceDir: string;
    };
    const ok = await confirmAlert({
      title: "撤销上一次整理？",
      message: `${new Date(time).toLocaleString("zh-CN")} 的整理，共 ${moves.length} 个文件将移回 ${sourceDir}`,
      primaryAction: { title: "撤销", style: Alert.ActionStyle.Default },
    });
    if (!ok) return;

    const toast = await showToast({ style: Toast.Style.Animated, title: "撤销中…" });
    try {
      undoLastRun(destDir);
      // undoLastRun renames the manifest to *.undone only when every file went back.
      if (!fs.existsSync(latestPath)) {
        toast.style = Toast.Style.Success;
        toast.title = `已撤销：${moves.length} 个文件移回原位`;
        toast.message = sourceDir;
        await popToRoot();
      } else {
        toast.style = Toast.Style.Failure;
        toast.title = "部分撤销";
        toast.message = "个别文件未能移回（可能已被移动或原位置有同名文件），记录已保留，可再次尝试";
      }
    } catch (err) {
      toast.style = Toast.Style.Failure;
      toast.title = "撤销失败";
      toast.message = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="撤销上一次整理" icon={Icon.Undo} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.FilePicker
        id="dest"
        title="上次整理的归档目录"
        allowMultipleSelection={false}
        canChooseDirectories
        canChooseFiles={false}
        info={
          (defaultDest ? `留空则使用默认归档目录：${defaultDest}。` : "") +
          "如果上次是「就地整理」，请选源文件夹本身。"
        }
        error={destError}
        onChange={() => setDestError(undefined)}
      />
    </Form>
  );
}
