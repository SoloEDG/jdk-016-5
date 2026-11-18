import { reactive } from "vue";
import type { Document } from "../../../shared/types";
import { defaultPlan, type PlanRow } from "../lib/plan";

export const exportSettings = reactive({
  open: false,
  width: 1280,
  height: 720,
  fps: 30,
  plan: [] as PlanRow[],
  /** 方案对应的作品签名，作品或步骤变化后方案自动重建。 */
  planKey: "",
  /** 开始导出后记录错误，供对话框内展示。 */
  error: "",
});
const planKeyOf = (doc: Document) =>
  `${doc.paper.id}:${doc.steps.map((s) => s.id).join(",")}`;
export function openExportDialog(doc: Document) {
  const key = planKeyOf(doc);
  if (exportSettings.planKey !== key || exportSettings.plan.length === 0) {
    exportSettings.plan = defaultPlan(doc);
    exportSettings.planKey = key;
  }
  exportSettings.error = "";
  exportSettings.open = true;
}
export function closeExportDialog() {
  exportSettings.open = false;
}
/** 把某次任务的设置载回对话框；方案与当前作品不匹配时重建默认方案。 */
export function loadIntoDialog(
  doc: Document,
  s: { width: number; height: number; fps: number; plan: PlanRow[] },
) {
  exportSettings.width = s.width;
  exportSettings.height = s.height;
  exportSettings.fps = s.fps;
  const fits = s.plan
    .filter((r) => r.kind === "step")
    .every((r) => r.stepIndex >= 1 && r.stepIndex < doc.steps.length);
  exportSettings.plan = fits
    ? s.plan.map((r) => ({ ...r }))
    : defaultPlan(doc);
  exportSettings.planKey = planKeyOf(doc);
  exportSettings.error = "";
  exportSettings.open = true;
}
export const RESOLUTIONS = [
  { label: "480p · 854 × 480", width: 854, height: 480 },
  { label: "720p · 1280 × 720", width: 1280, height: 720 },
  { label: "1080p · 1920 × 1080", width: 1920, height: 1080 },
];
export const FRAME_RATES = [24, 30, 60];
