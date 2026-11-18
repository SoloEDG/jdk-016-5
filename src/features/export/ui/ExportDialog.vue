<script setup lang="ts">
import { computed } from "vue";
import { Film, X } from "lucide-vue-next";
import type { Document } from "../../../shared/types";
import {
  exportSettings,
  closeExportDialog,
  RESOLUTIONS,
  FRAME_RATES,
} from "../model/settings";
import { startExport, activeTask } from "../model/tasks";
import { compilePlan } from "../lib/plan";
import { suggestBitrate } from "../lib/encode";
import { formatBytes, formatDuration } from "../lib/format";
const props = defineProps<{ doc: Document }>();
const resolution = computed({
  get: () => {
    const i = RESOLUTIONS.findIndex(
      (r) => r.width === exportSettings.width && r.height === exportSettings.height,
    );
    return i < 0 ? 1 : i;
  },
  set: (i: number) => {
    const r = RESOLUTIONS[i] ?? RESOLUTIONS[1]!;
    exportSettings.width = r.width;
    exportSettings.height = r.height;
  },
});
const compiled = computed(() =>
  compilePlan(exportSettings.plan, props.doc, exportSettings.fps),
);
const estimate = computed(() => {
  const bytes =
    (suggestBitrate(exportSettings.width, exportSettings.height, exportSettings.fps) *
      compiled.value.totalSeconds) /
    8;
  return formatBytes(bytes);
});
const running = computed(() => activeTask());
async function confirm() {
  const result = await startExport(props.doc, exportSettings);
  if (result.ok) closeExportDialog();
  else exportSettings.error = result.error;
}
</script>
<template>
  <div
    v-if="exportSettings.open"
    class="modal-backdrop"
    @click.self="closeExportDialog()"
  >
    <section class="help-modal export-modal" role="dialog" aria-label="导出教学视频">
      <button class="close" aria-label="关闭" @click="closeExportDialog()">
        <X :size="18" />
      </button>
      <div class="eyebrow">SHARE THE FOLD</div>
      <h2><Film :size="20" /> 导出教学视频</h2>
      <p class="export-intro">
        按下面的拍摄方案逐帧录制，导出过程不占用实时播放，你可以继续编辑作品。
      </p>
      <div class="export-section">
        <div class="line-label"><label>拍摄方案</label><span>按确认顺序呈现</span></div>
        <ul class="plan-list">
          <li
            v-for="row in exportSettings.plan"
            :key="row.id"
            class="plan-row"
            :class="{ off: !row.enabled }"
          >
            <label class="plan-check">
              <input
                v-if="row.kind !== 'step'"
                v-model="row.enabled"
                type="checkbox"
              />
              <i v-else class="plan-lock" title="折叠步骤完整保留">●</i>
            </label>
            <span class="plan-name">{{ row.label }}</span>
            <span class="plan-times">
              <template v-if="row.kind === 'step'">
                <label
                  >过渡
                  <input
                    v-model.number="row.duration"
                    type="number"
                    min="0.2"
                    max="30"
                    step="0.1"
                  />s</label
                >
                <label
                  >停留
                  <input
                    v-model.number="row.pause"
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                  />s</label
                >
              </template>
              <label v-else
                >时长
                <input
                  v-model.number="row.duration"
                  type="number"
                  min="0.2"
                  max="30"
                  step="0.1"
                />s</label
              >
            </span>
          </li>
        </ul>
      </div>
      <div class="export-grid">
        <label class="export-field">
          <span>清晰度</span>
          <select v-model.number="resolution">
            <option v-for="(r, i) in RESOLUTIONS" :key="r.label" :value="i">
              {{ r.label }}
            </option>
          </select>
        </label>
        <label class="export-field">
          <span>帧率</span>
          <select v-model.number="exportSettings.fps">
            <option v-for="f in FRAME_RATES" :key="f" :value="f">{{ f }} fps</option>
          </select>
        </label>
      </div>
      <div class="export-summary">
        共 <b>{{ compiled.totalFrames }}</b> 帧 · 约
        <b>{{ formatDuration(compiled.totalSeconds) }}</b> · 预计文件 ≈
        <b>{{ estimate }}</b>
      </div>
      <p v-if="running" class="export-warning">
        当前有导出任务进行中，开始新任务将取消它。
      </p>
      <p v-if="exportSettings.error" class="export-error" role="alert">
        {{ exportSettings.error }}
      </p>
      <div class="export-actions">
        <button class="reset" @click="closeExportDialog()">取消</button>
        <button class="primary" @click="confirm">
          开始导出 <Film :size="14" />
        </button>
      </div>
    </section>
  </div>
</template>
