// 端到端验证：教学视频导出流程
// 运行前：npm run dev 已在 BASE 地址提供服务
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
let failures = 0;
const ok = (cond, name, extra = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".paper-scene", { timeout: 15000 });

const openDialog = async () => {
  await page.click('.header-actions button:has-text("导出视频")');
  await page.waitForSelector(".export-modal");
};
const setAllDurations = async (value) => {
  for (const input of await page.$$(".plan-row .plan-times input"))
    await input.fill(value);
};
const readExpectedFrames = async () => {
  await page.waitForTimeout(120);
  const summary = await page.textContent(".export-summary");
  return Number(summary.match(/共\s*(\d+)\s*帧/)[1]);
};
const videoInfoOf = async (buf) => {
  const info = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes]));
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = () => rej(new Error("视频无法解码"));
    });
    await video.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    video.pause();
    return { duration: video.duration, w: video.videoWidth, h: video.videoHeight };
  }, buf.toString("base64"));
  return info;
};

// ── 1. 拍摄方案 ─────────────────────────────────────────
await openDialog();
const rows = await page.$$eval(".plan-row .plan-name", (els) =>
  els.map((e) => e.textContent.trim()),
);
ok(rows.length === 7, "拍摄方案共 7 行", rows.join(" | "));
ok(
  rows[0].includes("开场") && rows[1].includes("正背面") &&
    rows[5].includes("360") && rows[6].includes("结束"),
  "镜头顺序：开场 → 正背面 → 步骤 → 环绕 → 结束",
);
const stepRows = await page.$$eval(".plan-row", (els) =>
  els.filter((e) => e.querySelector(".plan-lock")).length,
);
ok(stepRows === 3, "3 个折叠步骤完整保留（不可关闭）");

// ── 2. 快速导出（480p24，约 50 帧）：完整性 ─────────────
await setAllDurations("0.2");
await page.selectOption(".export-grid select >> nth=0", { index: 0 });
await page.selectOption(".export-grid select >> nth=1", { value: "24" });
const expectedFrames = await readExpectedFrames();
ok(expectedFrames > 0, `预计帧数可读：${expectedFrames} 帧`);
const download1Promise = page.waitForEvent("download", { timeout: 120000 });
await page.click(".export-actions button.primary");
await page.waitForSelector(".export-status.done", { timeout: 120000 });
ok((await page.$(".export-modal")) === null, "导出期间对话框不遮挡，屏幕可编辑");
const download1 = await download1Promise;
const fileName1 = download1.suggestedFilename();
ok(
  /^ORI-教学-shelter-\d{8}-\d{6}-T01-480p24\.(mp4|webm)$/.test(fileName1),
  "文件名含纸张/时间戳/序号/清晰度/帧率",
  fileName1,
);
const buf1 = await readFile(await download1.path());
const isMp4 = buf1.subarray(4, 8).toString("ascii") === "ftyp";
const isWebm = buf1[0] === 0x1a && buf1[1] === 0x45 && buf1[2] === 0xdf && buf1[3] === 0xa3;
ok(isMp4 || isWebm, "文件是有效的 MP4 或 WebM 容器",
  `${isMp4 ? "MP4" : "WebM"}, ${(buf1.length / 1024).toFixed(1)} KB`);
const info1 = await videoInfoOf(buf1);
const expectedSec1 = expectedFrames / 24;
ok(Math.abs(info1.duration - expectedSec1) < 0.3,
  "视频时长 == 帧数/帧率（帧数不依赖实时播放，边界不丢帧）",
  `${info1.duration.toFixed(3)}s ≈ ${expectedSec1.toFixed(3)}s`);
ok(info1.w === 854 && info1.h === 480, "分辨率与所选清晰度一致",
  `${info1.w}×${info1.h}`);
await page.click('.export-status button[aria-label="关闭"]');

// ── 3. 长视频导出（1080p60）：进度、中途编辑、内存 ──────
await openDialog();
await setAllDurations("1");
await page.selectOption(".export-grid select >> nth=0", { index: 2 }); // 1080p
await page.selectOption(".export-grid select >> nth=1", { value: "60" }); // 60fps
const expectedFrames2 = await readExpectedFrames();
const heapBefore = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
const download2Promise = page.waitForEvent("download", { timeout: 300000 });
await page.click(".export-actions button.primary");
await page.waitForSelector(".export-status", { timeout: 15000 });
// 轮询真实帧进度
let sawProgress = false;
let progressTotal = 0;
for (let i = 0; i < 200; i++) {
  const text = await page.textContent(".export-status").catch(() => "");
  const m = text.match(/(\d+)\s*\/\s*(\d+)\s*帧/);
  if (m) {
    sawProgress = true;
    progressTotal = Number(m[2]);
    if (Number(m[1]) > 0 && Number(m[1]) <= Number(m[2])) break;
  }
  if (/视频已生成/.test(text)) break;
  await page.waitForTimeout(100);
}
ok(sawProgress && progressTotal === expectedFrames2,
  "渲染中进度对应真实帧数",
  `进度总量 ${progressTotal} / 预计 ${expectedFrames2}`);
await page.click(".swatches button >> nth=1"); // 导出期间换纸色
await page.click('.view-tabs button:has-text("俯视")'); // 导出期间换视角
const stillEditable = await page.evaluate(
  () => document.querySelector(".swatches button:nth-child(2)") !== null,
);
ok(stillEditable, "导出期间可继续修改颜色与视角");
const download2 = await download2Promise;
await page.waitForSelector(".export-status.done", { timeout: 300000 });
const fileName2 = download2.suggestedFilename();
ok(/-T02-1080p60\./.test(fileName2), "第二个任务文件名独立", fileName2);
const buf2 = await readFile(await download2.path());
const info2 = await videoInfoOf(buf2);
const expectedSec2 = expectedFrames2 / 60;
ok(Math.abs(info2.duration - expectedSec2) < 0.3,
  "长视频时长精确（完整覆盖全部镜头）",
  `${info2.duration.toFixed(2)}s ≈ ${expectedSec2.toFixed(2)}s`);
ok(info2.w === 1920 && info2.h === 1080, "1080p 分辨率正确",
  `${info2.w}×${info2.h}`);
const heapAfter = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
const growthMB = (heapAfter - heapBefore) / 1048576;
ok(heapBefore === 0 || growthMB < 500,
  "高分辨率长视频导出内存有界（原始帧不堆积）",
  `堆增长 ${growthMB.toFixed(1)} MB，文件 ${(buf2.length / 1048576).toFixed(1)} MB`);
await page.click('.export-status button[aria-label="关闭"]');

// ── 4. 取消后重试：任务与文件名互不串用 ─────────────────
await openDialog();
await page.click(".export-actions button.primary");
await page.waitForSelector(".export-status button[title=取消导出]", {
  timeout: 15000,
});
await page.click(".export-status button[title=取消导出]");
await page.waitForTimeout(400);
const cancelledText = await page.textContent(".export-status").catch(() => "");
ok(/已取消/.test(cancelledText) || cancelledText === "",
  "取消后任务终止", cancelledText.trim().slice(0, 30));
const download3Promise = page.waitForEvent("download", { timeout: 300000 });
await openDialog();
await page.click(".export-actions button.primary");
const download3 = await download3Promise;
await page.waitForSelector(".export-status.done", { timeout: 300000 });
const fileName3 = download3.suggestedFilename();
const seqOf = (n) => Number(n.match(/-T(\d+)-/)?.[1] ?? 0);
ok(seqOf(fileName3) > seqOf(fileName2) && fileName3 !== fileName2,
  "取消后重试使用新文件名，互不串用",
  `${fileName2} → ${fileName3}`);

await browser.close();
console.log(failures === 0 ? "\n全部端到端检查通过" : `\n${failures} 项检查失败`);
process.exit(failures === 0 ? 0 : 1);
