import { reactive } from "vue";
import type { Document } from "../../../shared/types";
import { takeSnapshot, type Snapshot } from "./snapshot";
import { compilePlan, type PlanRow } from "../lib/plan";
import { createRenderer } from "../lib/render";
import {
  encodeVideo,
  prepareEncoder,
  ExportCancelled,
  type PreparedEncoder,
} from "../lib/encode";
import { buildFileName } from "../lib/format";

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  plan: PlanRow[];
}
export type TaskState =
  | "rendering"
  | "finalizing"
  | "done"
  | "error"
  | "cancelled";
export interface ExportTask {
  id: number;
  fileName: string;
  state: TaskState;
  totalFrames: number;
  /** 已真实编码完成的帧数。 */
  framesDone: number;
  totalSeconds: number;
  codecLabel: string;
  error: string;
  blobUrl: string;
  size: number;
  cancelled: boolean;
  /** 任务启动时确认的设置副本，重试不依赖对话框现状。 */
  settings: ExportSettings;
}
export const exportStore = reactive({
  tasks: [] as ExportTask[],
  seq: 0,
});
/** 准备阶段（探测编码器）串行化，防止连点产生并发任务。 */
let starting = false;
export function activeTask() {
  return exportStore.tasks.find(
    (t) => t.state === "rendering" || t.state === "finalizing",
  );
}
export function latestTask() {
  return exportStore.tasks[exportStore.tasks.length - 1];
}
const cloneSettings = (s: ExportSettings): ExportSettings => ({
  width: s.width,
  height: s.height,
  fps: s.fps,
  plan: s.plan.map((r) => ({ ...r })),
});
/**
 * 启动导出任务。若已有任务进行中，先取消旧任务；
 * 每个任务持有独立快照、编码器与文件名，互不串用。
 */
export async function startExport(
  doc: Document,
  settings: ExportSettings,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (starting)
    return { ok: false, error: "正在准备上一个导出任务，请稍候再试。" };
  starting = true;
  try {
    const running = activeTask();
    if (running) cancelExport(running.id);
    const snapshot = takeSnapshot(doc);
    const own = cloneSettings(settings);
    const compiled = compilePlan(own.plan, snapshot, own.fps);
    if (compiled.totalFrames <= 0)
      return { ok: false, error: "拍摄方案为空，请至少保留一个镜头。" };
    const prepared = await prepareEncoder(own.width, own.height, own.fps);
    if (!prepared)
      return {
        ok: false,
        error: "当前浏览器不支持视频编码（WebCodecs），无法导出视频。",
      };
    const id = ++exportStore.seq;
    const task = reactive({
      id,
      fileName: buildFileName(snapshot.paper.id, id, own, prepared.ext),
      state: "rendering",
      totalFrames: compiled.totalFrames,
      framesDone: 0,
      totalSeconds: compiled.totalSeconds,
      codecLabel: prepared.codecLabel,
      error: "",
      blobUrl: "",
      size: 0,
      cancelled: false,
      settings: own,
    }) as ExportTask;
    exportStore.tasks.push(task);
    void runTask(task, snapshot, compiled, prepared);
    return { ok: true };
  } finally {
    starting = false;
  }
}
type Compiled = ReturnType<typeof compilePlan>;
async function runTask(
  task: ExportTask,
  snapshot: Snapshot,
  compiled: Compiled,
  prepared: PreparedEncoder,
) {
  const { width, height, fps } = task.settings;
  try {
    // 等待页面字体就绪，保证视频字幕与界面字体一致。
    await document.fonts.ready;
    if (task.cancelled) throw new ExportCancelled();
    const renderer = createRenderer(snapshot, width, height);
    const starts: number[] = [];
    let acc = 0;
    for (const seg of compiled.segments) {
      starts.push(acc);
      acc += seg.frames;
    }
    let cursor = 0;
    const renderFrame = (i: number) => {
      while (cursor < starts.length - 1 && starts[cursor + 1]! <= i) cursor++;
      renderer.draw(compiled.segments[cursor]!.stateAt(i - starts[cursor]!));
    };
    const result = await encodeVideo({
      canvas: renderer.canvas,
      width,
      height,
      fps,
      totalFrames: compiled.totalFrames,
      prepared,
      renderFrame,
      isCancelled: () => task.cancelled,
      onProgress: (n) => {
        task.framesDone = n;
      },
      onPhase: (phase) => {
        if (!task.cancelled) task.state = phase;
      },
    });
    if (task.cancelled) throw new ExportCancelled();
    task.size = result.blob.size;
    task.blobUrl = URL.createObjectURL(result.blob);
    task.state = "done";
    download(task.blobUrl, task.fileName);
  } catch (e) {
    if (task.cancelled || e instanceof ExportCancelled) {
      task.state = "cancelled";
      setTimeout(() => prune(task.id), 3000);
    } else {
      task.state = "error";
      task.error = e instanceof Error ? e.message : String(e);
    }
  }
}
function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
}
export function cancelExport(id: number) {
  const task = exportStore.tasks.find((t) => t.id === id);
  if (!task) return;
  task.cancelled = true;
  if (task.state === "rendering" || task.state === "finalizing") {
    task.state = "cancelled";
    setTimeout(() => prune(task.id), 3000);
  }
}
/** 用任务启动时确认的设置，对当前作品重新导出。 */
export function retryExport(doc: Document, id: number) {
  const task = exportStore.tasks.find((t) => t.id === id);
  if (!task) return Promise.resolve({ ok: false as const, error: "任务不存在" });
  const settings = cloneSettings(task.settings);
  dismissExport(id);
  return startExport(doc, settings);
}
export function dismissExport(id: number) {
  const i = exportStore.tasks.findIndex((t) => t.id === id);
  if (i < 0) return;
  const task = exportStore.tasks[i]!;
  if (task.blobUrl) URL.revokeObjectURL(task.blobUrl);
  exportStore.tasks.splice(i, 1);
}
function prune(id: number) {
  const task = exportStore.tasks.find((t) => t.id === id);
  if (task && task.state === "cancelled") dismissExport(id);
}
