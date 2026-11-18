import type { View } from "../../../shared/types";
import { solvePose, hingePositions } from "../../fold/lib/kinematics";
import { project, cameraPoint, type Stage } from "../../observe/lib/projection";
import type { Snapshot } from "../model/snapshot";
import type { SceneState } from "./plan";

const STAGE: Stage = { w: 800, h: 560, scale: 145 };
export interface Renderer {
  canvas: HTMLCanvasElement;
  draw(state: SceneState): void;
}
function patternCanvas(w: number, h: number, paint: (c: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  return c;
}
/** 离屏画布渲染器：与视口同一套投影与配色，逐帧确定性绘制。 */
export function createRenderer(snap: Snapshot, width: number, height: number): Renderer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const s = Math.min(width / STAGE.w, height / STAGE.h);
  const ox = (width - STAGE.w * s) / 2;
  const oy = (height - STAGE.h * s) / 2;
  const grid = ctx.createPattern(
    patternCanvas(35, 35, (c) => {
      c.fillStyle = "#d4d9d0";
      c.beginPath();
      c.arc(1, 1, 0.8, 0, Math.PI * 2);
      c.fill();
    }),
    "repeat",
  )!;
  const fiber = ctx.createPattern(
    patternCanvas(13, 17, (c) => {
      c.strokeStyle = "rgba(255,255,255,0.22)";
      c.lineWidth = 0.7;
      c.beginPath();
      c.moveTo(1, 2);
      c.lineTo(4, 3);
      c.moveTo(8, 11);
      c.lineTo(10, 9);
      c.moveTo(3, 14);
      c.lineTo(4, 12);
      c.stroke();
    }),
    "repeat",
  )!;
  const dots = ctx.createPattern(
    patternCanvas(9, 9, (c) => {
      c.fillStyle = "rgba(255,255,255,0.4)";
      c.beginPath();
      c.arc(2, 2, 0.65, 0, Math.PI * 2);
      c.fill();
    }),
    "repeat",
  )!;
  const texture = snap.texture === "dots" ? dots : fiber;
  function trace(points: [number, number, number][], view: View) {
    ctx.beginPath();
    points.forEach((p, i) => {
      const v = project(p, view, STAGE);
      if (i === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
  }
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function draw(state: SceneState) {
    const view: View = {
      yaw: state.yaw,
      pitch: state.pitch,
      zoom: state.zoom,
      grid: snap.view.grid,
      wire: snap.view.wire,
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#f6f7f2";
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(s, 0, 0, s, ox, oy);
    if (view.grid) {
      ctx.fillStyle = grid;
      ctx.fillRect(0, 0, STAGE.w, STAGE.h);
    }
    ctx.save();
    ctx.translate(400, 401);
    ctx.scale(1, 32 / 180);
    const shadow = ctx.createRadialGradient(0, 0, 10, 0, 0, 180);
    shadow.addColorStop(0, "rgba(99,112,90,0.15)");
    shadow.addColorStop(1, "rgba(99,112,90,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(0, 0, 180, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const pose = solvePose(snap.paper, state.angles);
    const faces = pose
      .map((f) => ({
        ...f,
        depth:
          f.points.reduce((sum, p) => sum + project(p, view, STAGE).z, 0) /
          f.points.length,
        back: cameraPoint(f.normal, view)[2] > 0,
      }))
      .sort((a, b) => a.depth - b.depth);
    ctx.lineJoin = "round";
    for (const f of faces) {
      trace(f.points, view);
      ctx.fillStyle = f.back ? snap.back : snap.front;
      ctx.fill();
      ctx.strokeStyle = "rgba(120,89,69,0.35)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = `rgba(49,70,56,${Math.max(0, 0.1 + f.normal[1] * 0.08)})`;
      ctx.fill();
      if (snap.texture !== "plain") {
        ctx.fillStyle = texture;
        ctx.fill();
      }
    }
    if (view.wire) {
      const hinges = hingePositions(snap.paper, pose);
      hinges.forEach((h, i) => {
        const a = project(h.a, view, STAGE);
        const b = project(h.b, view, STAGE);
        const active = h.id === state.activeCrease;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = active ? "#fff8d9" : "#746f57";
        ctx.lineWidth = active ? 2.5 : 1.2;
        ctx.stroke();
        ctx.setLineDash([]);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        ctx.beginPath();
        ctx.arc(mx, my, 11, 0, Math.PI * 2);
        ctx.fillStyle = active ? "#384d3f" : "#f7f6ee";
        ctx.fill();
        ctx.fillStyle = active ? "#ffffff" : "#555555";
        ctx.font = '10px "Noto Sans SC", sans-serif';
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), mx, my + 0.5);
      });
    }
    ctx.save();
    ctx.translate(58, 475);
    ctx.lineWidth = 1.5;
    const axis = (x: number, y: number, color: string) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, y);
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    axis(28, 12, "#be806c");
    axis(0, -30, "#839b72");
    axis(-18, 15, "#839eae");
    ctx.font = '10px "Noto Sans SC", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ad7a69";
    ctx.fillText("X", 32, 17);
    ctx.fillStyle = "#789069";
    ctx.fillText("Y", -3, -37);
    ctx.fillStyle = "#839eae";
    ctx.fillText("Z", -28, 23);
    ctx.restore();
    ctx.font = '12px "Noto Sans SC", sans-serif';
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = state.caption;
    const w = ctx.measureText(label).width + 24;
    roundRect(24, 22, w, 30, 6);
    ctx.fillStyle = "rgba(38,58,44,0.78)";
    ctx.fill();
    ctx.fillStyle = "#fbf8ef";
    ctx.fillText(label, 36, 37.5);
    ctx.font = '10px "Noto Sans SC", sans-serif';
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(110,120,105,0.6)";
    ctx.fillText(`折间 ORI · ${snap.paper.name}`, STAGE.w - 24, STAGE.h - 20);
  }
  return { canvas, draw };
}
