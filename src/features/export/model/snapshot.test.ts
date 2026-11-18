import { describe, it, expect } from "vitest";
import { takeSnapshot } from "./snapshot";
import { createDocument } from "../../../shared/document";
import { papers } from "../../paper/lib/presets";
import { makeSteps } from "../../sequence/lib/steps";

describe("takeSnapshot 快照隔离", () => {
  it("快照后修改文档（颜色/步骤/视角/角度）不影响快照", () => {
    const doc = createDocument(papers[0]!, makeSteps(papers[0]!));
    const snap = takeSnapshot(doc);
    doc.front = "#000000";
    doc.back = "#111111";
    doc.texture = "plain";
    doc.view.yaw = 123;
    doc.steps[1]!.angles = { c1: -99 };
    doc.steps[1]!.title = "被改掉";
    doc.angles = { c1: 5 };
    expect(snap.front).not.toBe("#000000");
    expect(snap.texture).toBe("fiber");
    expect(snap.view.yaw).toBe(-35);
    expect(snap.steps[1]!.angles).not.toEqual({ c1: -99 });
    expect(snap.steps[1]!.title).not.toBe("被改掉");
  });
  it("纸张几何是深拷贝，替换纸张或改点坐标不影响快照", () => {
    const doc = createDocument(papers[0]!, makeSteps(papers[0]!));
    const snap = takeSnapshot(doc);
    const before = snap.paper.faces[0]!.points[0]![0];
    doc.paper.faces[0]!.points[0]![0] = 999;
    doc.paper = papers[1]!;
    expect(snap.paper.faces[0]!.points[0]![0]).toBe(before);
    expect(snap.paper.id).toBe(papers[0]!.id);
  });
  it("两份快照互不共享引用", () => {
    const doc = createDocument(papers[0]!, makeSteps(papers[0]!));
    const a = takeSnapshot(doc);
    const b = takeSnapshot(doc);
    a.steps[1]!.angles["c1"] = 42;
    a.view.yaw = 0;
    expect(b.steps[1]!.angles["c1"]).not.toBe(42);
    expect(b.view.yaw).toBe(-35);
  });
});
