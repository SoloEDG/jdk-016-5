<script setup lang="ts">
import { computed } from "vue";
import {
  CheckCircle2,
  Download,
  Loader2,
  OctagonX,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-vue-next";
import type { Document } from "../../../shared/types";
import {
  latestTask,
  cancelExport,
  dismissExport,
  retryExport,
} from "../model/tasks";
import { loadIntoDialog } from "../model/settings";
import { formatBytes, formatDuration } from "../lib/format";
const props = defineProps<{ doc: Document }>();
const task = computed(() => latestTask());
const percent = computed(() => {
  const t = task.value;
  if (!t || t.totalFrames === 0) return 0;
  return Math.min(100, Math.round((t.framesDone / t.totalFrames) * 100));
});
function retry() {
  const t = task.value;
  if (t) void retryExport(props.doc, t.id);
}
function adjust() {
  const t = task.value;
  if (t) loadIntoDialog(props.doc, t.settings);
}
function downloadAgain() {
  const t = task.value;
  if (!t?.blobUrl) return;
  const a = document.createElement("a");
  a.href = t.blobUrl;
  a.download = t.fileName;
  a.click();
}
</script>
<template>
  <aside v-if="task" class="export-status" :class="task.state" role="status">
    <template v-if="task.state === 'rendering' || task.state === 'finalizing'">
      <Loader2 :size="18" class="spin" />
      <div class="export-status-body">
        <b>{{ task.state === "rendering" ? "正在逐帧渲染" : "正在封装视频" }}</b>
        <span class="export-status-file">{{ task.fileName }}</span>
        <span class="export-status-meta">
          {{ task.framesDone }} / {{ task.totalFrames }} 帧 · {{ percent }}%
        </span>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: percent + '%' }"></div>
        </div>
      </div>
      <button
        class="icon-button"
        title="取消导出"
        aria-label="取消导出"
        @click="cancelExport(task.id)"
      >
        <X :size="16" />
      </button>
    </template>
    <template v-else-if="task.state === 'done'">
      <CheckCircle2 :size="18" class="ok" />
      <div class="export-status-body">
        <b>视频已生成</b>
        <span class="export-status-file">{{ task.fileName }}</span>
        <span class="export-status-meta">
          {{ formatBytes(task.size) }} · {{ task.codecLabel }} ·
          {{ formatDuration(task.totalSeconds) }}
        </span>
        <div class="export-status-actions">
          <button class="text-button" @click="downloadAgain">
            <Download :size="13" /> 重新下载
          </button>
          <button class="text-button" @click="dismissExport(task.id)">完成</button>
        </div>
      </div>
      <button
        class="icon-button"
        aria-label="关闭"
        @click="dismissExport(task.id)"
      >
        <X :size="16" />
      </button>
    </template>
    <template v-else-if="task.state === 'error'">
      <OctagonX :size="18" class="bad" />
      <div class="export-status-body">
        <b>导出失败</b>
        <span class="export-status-meta">{{ task.error }}</span>
        <div class="export-status-actions">
          <button class="text-button" @click="retry">
            <RefreshCw :size="13" /> 重试
          </button>
          <button class="text-button" @click="adjust">
            <SlidersHorizontal :size="13" /> 调整参数
          </button>
        </div>
      </div>
      <button
        class="icon-button"
        aria-label="关闭"
        @click="dismissExport(task.id)"
      >
        <X :size="16" />
      </button>
    </template>
    <template v-else>
      <X :size="16" />
      <div class="export-status-body"><b>已取消导出</b></div>
    </template>
  </aside>
</template>
