import type { ExportSettings } from "../model/tasks";
const pad = (n: number) => String(n).padStart(2, "0");
/** 文件名含纸张、时间戳与任务序号，连续/重试任务互不串名。 */
export function buildFileName(
  paperId: string,
  seq: number,
  settings: Pick<ExportSettings, "height" | "fps">,
  ext: string,
  now: Date = new Date(),
): string {
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safePaper = paperId.replace(/[\\/:*?"<>|\s]+/g, "_");
  return `ORI-教学-${safePaper}-${stamp}-T${pad(seq)}-${settings.height}p${settings.fps}.${ext}`;
}
export function formatBytes(n: number) {
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + " MB";
  if (n >= 1 << 10) return (n / (1 << 10)).toFixed(0) + " KB";
  return n + " B";
}
export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m} 分 ${s.toFixed(1)} 秒` : `${s.toFixed(1)} 秒`;
}
