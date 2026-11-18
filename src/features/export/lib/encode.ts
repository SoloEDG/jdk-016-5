import { Muxer as Mp4Muxer, StreamTarget as Mp4StreamTarget } from "mp4-muxer";
import { Muxer as WebmMuxer, StreamTarget as WebmStreamTarget } from "webm-muxer";

export interface PreparedEncoder {
  config: VideoEncoderConfig;
  container: "mp4" | "webm";
  codecLabel: string;
  ext: string;
}
export interface EncodeResult {
  blob: Blob;
  codecLabel: string;
}
export class ExportCancelled extends Error {
  constructor() {
    super("导出已取消");
    this.name = "ExportCancelled";
  }
}
/** 按像素与帧率估算码率（bps），清晰度越高码率越大。 */
export function suggestBitrate(width: number, height: number, fps: number) {
  return Math.min(30_000_000, Math.max(1_000_000, Math.round(width * height * fps * 0.12)));
}
const CANDIDATES: { codec: string; container: "mp4" | "webm"; label: string }[] = [
  { codec: "avc1.640034", container: "mp4", label: "H.264 High" },
  { codec: "avc1.64002a", container: "mp4", label: "H.264 High" },
  { codec: "avc1.4d002a", container: "mp4", label: "H.264 Main" },
  { codec: "avc1.42002a", container: "mp4", label: "H.264 Baseline" },
  { codec: "vp09.00.10.08", container: "webm", label: "VP9" },
  { codec: "vp8", container: "webm", label: "VP8" },
];
/** 探测当前浏览器可用的编码器与封装格式；都不支持时返回 null。 */
export async function prepareEncoder(
  width: number,
  height: number,
  fps: number,
): Promise<PreparedEncoder | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined")
    return null;
  const bitrate = suggestBitrate(width, height, fps);
  for (const c of CANDIDATES) {
    const config: VideoEncoderConfig = {
      codec: c.codec,
      width,
      height,
      framerate: fps,
      bitrate,
      latencyMode: "quality",
    };
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support.supported) {
        return {
          config,
          container: c.container,
          codecLabel: c.label,
          ext: c.container === "mp4" ? "mp4" : "webm",
        };
      }
    } catch {
      /* 尝试下一个候选 */
    }
  }
  return null;
}
const yieldControl = () => new Promise<void>((r) => setTimeout(r, 0));
/**
 * 逐帧渲染并编码。帧 i 的时间戳严格为 i/fps，与设备实时节奏无关；
 * 原始帧即编即弃，封装数据流式写入分片，内存占用有上界。
 */
export async function encodeVideo(opts: {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  prepared: PreparedEncoder;
  renderFrame: (i: number) => void;
  isCancelled: () => boolean;
  onProgress: (encoded: number) => void;
  onPhase: (phase: "rendering" | "finalizing") => void;
}): Promise<EncodeResult> {
  const { prepared, fps, totalFrames } = opts;
  const chunks: { position: number; data: Uint8Array<ArrayBuffer> }[] = [];
  const collect = (data: Uint8Array, position: number) => {
    // 复制到独立缓冲区：既满足 BlobPart 类型，也避免复用底层缓冲。
    chunks.push({ position, data: new Uint8Array(data) });
  };
  let muxer: { addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void; finalize: () => void };
  if (prepared.container === "mp4") {
    muxer = new Mp4Muxer({
      target: new Mp4StreamTarget({
        onData: collect,
        chunked: true,
      }),
      video: { codec: "avc", width: opts.width, height: opts.height },
      fastStart: false,
    });
  } else {
    muxer = new WebmMuxer({
      target: new WebmStreamTarget({
        onData: collect,
        chunked: true,
      }),
      video: {
        codec: prepared.config.codec.startsWith("vp09") ? "V_VP9" : "V_VP8",
        width: opts.width,
        height: opts.height,
        frameRate: fps,
      },
    });
  }
  let failure: Error | null = null;
  let encoded = 0;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
      encoded++;
      opts.onProgress(encoded);
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(prepared.config);
  const keyInterval = Math.max(1, Math.round(fps * 2));
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (opts.isCancelled()) throw new ExportCancelled();
      if (failure) throw failure;
      opts.renderFrame(i);
      const timestamp = Math.round((i * 1_000_000) / fps);
      const duration = Math.round(((i + 1) * 1_000_000) / fps) - timestamp;
      const frame = new VideoFrame(opts.canvas, { timestamp, duration });
      encoder.encode(frame, { keyFrame: i % keyInterval === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 6) {
        await new Promise<void>((resolve) =>
          encoder.addEventListener("dequeue", () => resolve(), { once: true }),
        );
      }
      if ((i & 7) === 7) await yieldControl();
    }
    opts.onPhase("finalizing");
    await encoder.flush();
    if (failure) throw failure;
    if (opts.isCancelled()) throw new ExportCancelled();
    muxer.finalize();
  } catch (e) {
    try {
      if (encoder.state !== "closed") encoder.close();
    } catch {
      /* 已关闭 */
    }
    throw e;
  }
  const type = prepared.container === "mp4" ? "video/mp4" : "video/webm";
  // 按字节偏移组装，与封装器的写入顺序无关。
  chunks.sort((a, b) => a.position - b.position);
  const parts: BlobPart[] = chunks.map((c) => c.data);
  return {
    blob: new Blob(parts, { type }),
    codecLabel: prepared.codecLabel,
  };
}
