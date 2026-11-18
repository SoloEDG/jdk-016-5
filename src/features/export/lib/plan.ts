import type { Paper, Step, View } from "../../../shared/types";
import { interpolate } from "../../sequence/lib/steps";

/** 拍摄方案的数据来源（文档或其快照，结构一致即可）。 */
export interface PlanSource {
  paper: Paper;
  steps: Step[];
  view: View;
}
export type RowKind = "opening" | "showcase" | "step" | "finale" | "closing";
export interface PlanRow {
  id: string;
  kind: RowKind;
  label: string;
  /** 步骤行代表一次完整折叠，不可关闭，保证覆盖完整转动过程。 */
  enabled: boolean;
  /** 秒。步骤行指过渡时长，其余行指镜头时长。 */
  duration: number;
  /** 秒。仅步骤行：折完后的停留展示。 */
  pause: number;
  /** 仅步骤行：对应 steps 的下标（从 1 开始，0 是平展准备）。 */
  stepIndex: number;
}
/** 某一帧的画面状态：纸面角度 + 镜头 + 字幕。 */
export interface SceneState {
  angles: Record<string, number>;
  yaw: number;
  pitch: number;
  zoom: number;
  stepIndex: number;
  activeCrease: string;
  caption: string;
}
export interface Segment {
  caption: string;
  /** 该段精确占用的帧数。 */
  frames: number;
  /** f ∈ [0, frames)，返回第 f 帧的画面状态。 */
  stateAt(f: number): SceneState;
}
export interface CompiledPlan {
  segments: Segment[];
  totalFrames: number;
  /** = totalFrames / fps，精确时长。 */
  totalSeconds: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const smooth = (t: number) => t * t * (3 - 2 * t);

export function defaultPlan(source: PlanSource): PlanRow[] {
  const rows: PlanRow[] = [
    {
      id: "opening",
      kind: "opening",
      label: "开场定格 · 平展纸张",
      enabled: true,
      duration: 1.6,
      pause: 0,
      stepIndex: 0,
    },
    {
      id: "showcase",
      kind: "showcase",
      label: "正背面展示 · 镜头环绕",
      enabled: true,
      duration: 3.2,
      pause: 0,
      stepIndex: 0,
    },
  ];
  for (let i = 1; i < source.steps.length; i++) {
    const s = source.steps[i]!;
    rows.push({
      id: "step-" + i,
      kind: "step",
      label: `第 ${pad2(i + 1)} 步 · ${s.title}`,
      enabled: true,
      duration: Math.max(0.4, s.duration / 1000),
      pause: 1,
      stepIndex: i,
    });
  }
  rows.push(
    {
      id: "finale",
      kind: "finale",
      label: "成品展示 · 360° 环绕",
      enabled: true,
      duration: 4,
      pause: 0,
      stepIndex: source.steps.length - 1,
    },
    {
      id: "closing",
      kind: "closing",
      label: "结束定格 · 成品形态",
      enabled: true,
      duration: 1.2,
      pause: 0,
      stepIndex: source.steps.length - 1,
    },
  );
  return rows;
}

/**
 * 把拍摄方案编译成逐帧确定的段落序列。
 * 帧数只由「时长 × 帧率」决定，与设备播放是否卡顿无关；
 * 每段第一帧精确落在起始形态，下一段第一帧精确落在结束形态，
 * 首尾与步骤边界不重复、不丢帧。
 */
export function compilePlan(
  plan: PlanRow[],
  source: PlanSource,
  fps: number,
): CompiledPlan {
  const base = source.view;
  const steps = source.steps;
  const last = steps.length - 1;
  /** 时长 → 帧数：非法输入（空/负数/NaN）兜底为 1 帧。 */
  const frameCount = (sec: number) => {
    const n = Math.round(sec * fps);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  /** 停留 → 帧数：允许 0（不产生停留段），非法输入按 0 处理。 */
  const pauseCount = (sec: number) => {
    const n = Math.round(sec * fps);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const segments: Segment[] = [];
  const still = (
    stepIndex: number,
    caption: string,
    yaw = base.yaw,
  ): SceneState => ({
    angles: { ...steps[stepIndex]!.angles },
    yaw,
    pitch: base.pitch,
    zoom: base.zoom,
    stepIndex,
    activeCrease: source.paper.creases[stepIndex - 1]?.id ?? "",
    caption,
  });
  for (const row of plan) {
    if (!row.enabled) continue;
    if (row.kind === "opening") {
      const caption = steps[0]?.title ?? "准备纸张";
      const n = frameCount(row.duration);
      segments.push({ caption, frames: n, stateAt: () => still(0, caption) });
    } else if (row.kind === "showcase") {
      const caption = "正背面展示";
      const n = frameCount(row.duration);
      segments.push({
        caption,
        frames: n,
        stateAt: (f) => {
          const t = f / n;
          const turn =
            t < 0.4
              ? 180 * smooth(t / 0.4)
              : t < 0.6
                ? 180
                : 180 + 180 * smooth((t - 0.6) / 0.4);
          return still(0, caption, base.yaw + turn);
        },
      });
    } else if (row.kind === "step") {
      const i = row.stepIndex;
      if (i < 1 || i > last) continue;
      const caption = `${pad2(i + 1)} · ${steps[i]!.title}`;
      const from = steps[i - 1]!.angles;
      const to = steps[i]!.angles;
      const crease = source.paper.creases[i - 1]?.id ?? "";
      const n = frameCount(row.duration);
      segments.push({
        caption,
        frames: n,
        stateAt: (f) => ({
          angles: interpolate(from, to, f / n),
          yaw: base.yaw,
          pitch: base.pitch,
          zoom: base.zoom,
          stepIndex: i,
          activeCrease: crease,
          caption,
        }),
      });
      const p = pauseCount(row.pause);
      if (p > 0) {
        segments.push({
          caption,
          frames: p,
          stateAt: () => ({
            angles: { ...to },
            yaw: base.yaw,
            pitch: base.pitch,
            zoom: base.zoom,
            stepIndex: i,
            activeCrease: crease,
            caption,
          }),
        });
      }
    } else if (row.kind === "finale") {
      const caption = "成品展示 · 360°";
      const n = frameCount(row.duration);
      segments.push({
        caption,
        frames: n,
        stateAt: (f) => still(last, caption, base.yaw + (360 * f) / n),
      });
    } else if (row.kind === "closing") {
      const caption = "折叠完成";
      const n = frameCount(row.duration);
      segments.push({
        caption,
        frames: n,
        stateAt: () => still(last, caption),
      });
    }
  }
  const totalFrames = segments.reduce((s, x) => s + x.frames, 0);
  return { segments, totalFrames, totalSeconds: totalFrames / fps };
}
