import { describe, it, expect } from "vitest";
import { defaultPlan, compilePlan, type PlanRow } from "./plan";
import { papers } from "../../paper/lib/presets";
import { makeSteps } from "../../sequence/lib/steps";
import type { View } from "../../../shared/types";

const view: View = { yaw: -35, pitch: 50, zoom: 1, grid: true, wire: true };
function source() {
  return { paper: papers[0]!, steps: makeSteps(papers[0]!), view };
}
/** 语义比较：缺失的键按 0 处理（与求解器一致）。 */
function expectAngles(
  actual: Record<string, number>,
  expected: Record<string, number>,
) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  for (const k of keys) expect(actual[k] ?? 0).toBeCloseTo(expected[k] ?? 0, 10);
}

describe("defaultPlan", () => {
  it("按确认顺序排列：开场 → 正背面 → 逐步 → 环绕 → 结束", () => {
    const plan = defaultPlan(source());
    expect(plan.map((r) => r.kind)).toEqual([
      "opening",
      "showcase",
      "step",
      "step",
      "step",
      "finale",
      "closing",
    ]);
    expect(plan.filter((r) => r.kind === "step").map((r) => r.stepIndex)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("compilePlan 帧数确定性", () => {
  it("总帧数只由时长×帧率决定，与任何实时因素无关", () => {
    const src = source();
    const plan = defaultPlan(src);
    const a = compilePlan(plan, src, 30);
    const b = compilePlan(plan, src, 30);
    const expected =
      Math.round(1.6 * 30) +
      Math.round(3.2 * 30) +
      3 * (Math.round(1.6 * 30) + Math.round(1 * 30)) +
      Math.round(4 * 30) +
      Math.round(1.2 * 30);
    expect(a.totalFrames).toBe(expected);
    expect(b.totalFrames).toBe(expected);
    expect(a.totalSeconds).toBeCloseTo(expected / 30, 10);
    // 同一输入重复编译，逐帧状态完全一致
    for (const si in a.segments) {
      const sa = a.segments[si]!;
      const sb = b.segments[si]!;
      expect(sb.frames).toBe(sa.frames);
      for (let f = 0; f < sa.frames; f++) {
        expect(sb.stateAt(f)).toEqual(sa.stateAt(f));
      }
    }
  });
  it("帧率改变时帧数按比例变化，时长不变", () => {
    const src = source();
    const plan = defaultPlan(src);
    const a = compilePlan(plan, src, 24);
    const b = compilePlan(plan, src, 60);
    expect(Math.abs(a.totalSeconds - b.totalSeconds)).toBeLessThan(0.15);
    expect(b.totalFrames).toBeGreaterThan(a.totalFrames);
  });
});

describe("compilePlan 边界不丢帧不重复", () => {
  function states(src: ReturnType<typeof source>, fps = 30) {
    const compiled = compilePlan(defaultPlan(src), src, fps);
    const all: ReturnType<(typeof compiled.segments)[0]["stateAt"]>[] = [];
    for (const seg of compiled.segments)
      for (let f = 0; f < seg.frames; f++) all.push(seg.stateAt(f));
    return { compiled, all };
  }
  it("首帧精确是平展形态，末帧精确是成品形态", () => {
    const src = source();
    const { all } = states(src);
    expectAngles(all[0]!.angles, src.steps[0]!.angles);
    expectAngles(
      all[all.length - 1]!.angles,
      src.steps[src.steps.length - 1]!.angles,
    );
  });
  it("每个步骤边界：过渡首帧=上一步形态，停留首帧=目标形态", () => {
    const src = source();
    const { compiled } = states(src);
    const stepSegs = compiled.segments.filter((s) =>
      /^\d{2} ·/.test(s.caption),
    );
    // 每个步骤产生「过渡 + 停留」两段
    expect(stepSegs.length).toBe(6);
    for (let i = 0; i < 3; i++) {
      const transition = stepSegs[i * 2]!;
      const pause = stepSegs[i * 2 + 1]!;
      expectAngles(transition.stateAt(0).angles, src.steps[i]!.angles);
      expectAngles(pause.stateAt(0).angles, src.steps[i + 1]!.angles);
      // 过渡最后一帧不重复目标形态（由停留段精确承接）
      if (transition.frames > 1) {
        const last = transition.stateAt(transition.frames - 1).angles;
        const target = src.steps[i + 1]!.angles;
        const keys = Object.keys(target);
        expect(
          keys.some(
            (k) => Math.abs((last[k] ?? 0) - (target[k] ?? 0)) > 1e-6,
          ),
        ).toBe(true);
      }
    }
  });
  it("环绕镜头末帧不重复下一镜头首帧", () => {
    const src = source();
    const { compiled } = states(src);
    const finale = compiled.segments.find((s) => s.caption.includes("360"))!;
    const closing = compiled.segments[compiled.segments.length - 1]!;
    const lastYaw = finale.stateAt(finale.frames - 1).yaw;
    expect(lastYaw).toBeLessThan(view.yaw + 360);
    expect(closing.stateAt(0).yaw).toBe(view.yaw);
    expect(lastYaw).not.toBe(view.yaw);
  });
  it("正背面展示从当前镜头出发并回到当前镜头", () => {
    const src = source();
    const { compiled } = states(src);
    const seg = compiled.segments[1]!;
    expect(seg.caption).toBe("正背面展示");
    expect(seg.stateAt(0).yaw).toBe(view.yaw);
    const mid = seg.stateAt(Math.floor(seg.frames / 2));
    expect(Math.abs(mid.yaw - (view.yaw + 180))).toBeLessThan(20);
  });
});

describe("compilePlan 方案裁剪", () => {
  const row = (over: Partial<PlanRow>): PlanRow => ({
    id: "x",
    kind: "opening",
    label: "x",
    enabled: true,
    duration: 1,
    pause: 0,
    stepIndex: 0,
    ...over,
  });
  it("停驻 0 秒的步骤不产生停留段", () => {
    const src = source();
    const compiled = compilePlan(
      [row({ kind: "step", id: "s1", stepIndex: 1, duration: 1, pause: 0 })],
      src,
      30,
    );
    expect(compiled.segments.length).toBe(1);
    expect(compiled.totalFrames).toBe(30);
  });
  it("关闭的镜头不参与渲染", () => {
    const src = source();
    const compiled = compilePlan(
      [
        row({ kind: "opening", id: "o", enabled: false }),
        row({ kind: "closing", id: "c", duration: 2 }),
      ],
      src,
      30,
    );
    expect(compiled.segments.length).toBe(1);
    expect(compiled.totalFrames).toBe(60);
  });
  it("越界的步骤行被安全跳过", () => {
    const src = source();
    const compiled = compilePlan(
      [
        row({ kind: "step", id: "bad", stepIndex: 99 }),
        row({ kind: "closing", id: "c" }),
      ],
      src,
      30,
    );
    expect(compiled.segments.length).toBe(1);
  });
  it("时长不足一帧时至少保留一帧", () => {
    const src = source();
    const compiled = compilePlan([row({ duration: 0.01 })], src, 30);
    expect(compiled.totalFrames).toBe(1);
  });
  it("非法时长输入（NaN/负数）不会污染总帧数", () => {
    const src = source();
    const compiled = compilePlan(
      [
        row({ id: "a", duration: Number("x"), pause: 0 }),
        row({ id: "b", kind: "step", stepIndex: 1, duration: -2, pause: Number("y") }),
        row({ id: "c", kind: "closing", duration: 1 }),
      ],
      src,
      30,
    );
    expect(Number.isFinite(compiled.totalFrames)).toBe(true);
    // a 兜底 1 帧 + 步骤过渡 1 帧（无停留段）+ 结束 30 帧
    expect(compiled.totalFrames).toBe(1 + 1 + 30);
  });
});
