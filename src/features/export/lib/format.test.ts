import { describe, it, expect } from "vitest";
import { buildFileName, formatBytes, formatDuration } from "./format";

describe("buildFileName 文件名隔离", () => {
  const settings = { height: 720, fps: 30 };
  const now = new Date(2026, 10, 18, 9, 8, 7);
  it("包含纸张、序号、清晰度与帧率", () => {
    const name = buildFileName("shelter", 3, settings, "mp4", now);
    expect(name).toBe("ORI-教学-shelter-20261118-090807-T03-720p30.mp4");
  });
  it("连续任务序号不同则文件名不同", () => {
    const a = buildFileName("shelter", 1, settings, "mp4", now);
    const b = buildFileName("shelter", 2, settings, "mp4", now);
    expect(a).not.toBe(b);
  });
  it("切换纸张或格式后文件名不串用", () => {
    const a = buildFileName("shelter", 4, settings, "mp4", now);
    const b = buildFileName("ribbon", 4, settings, "mp4", now);
    const c = buildFileName("shelter", 4, settings, "webm", now);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
  it("非法字符被替换", () => {
    expect(buildFileName("纸 间/1", 1, settings, "mp4", now)).toContain("纸_间_1");
  });
});

describe("格式化", () => {
  it("字节数", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
  it("时长", () => {
    expect(formatDuration(12.5)).toBe("12.5 秒");
    expect(formatDuration(65)).toBe("1 分 5.0 秒");
  });
});
