import type { Vec3, View } from "../../../shared/types";
export interface Stage {
  w: number;
  h: number;
  scale: number;
}
export const DEFAULT_STAGE: Stage = { w: 800, h: 560, scale: 145 };
export function cameraPoint(p: Vec3, view: View): Vec3 {
  const a = (view.yaw * Math.PI) / 180,
    b = (view.pitch * Math.PI) / 180,
    x = p[0] * Math.cos(a) - p[2] * Math.sin(a),
    z = p[0] * Math.sin(a) + p[2] * Math.cos(a);
  return [
    x,
    p[1] * Math.cos(b) - z * Math.sin(b),
    p[1] * Math.sin(b) + z * Math.cos(b),
  ];
}
export function project(p: Vec3, view: View, stage: Stage = DEFAULT_STAGE) {
  const c = cameraPoint(p, view);
  return {
    x: stage.w / 2 + c[0] * stage.scale * view.zoom,
    y: stage.h / 2 - c[1] * stage.scale * view.zoom,
    z: c[2],
  };
}
export function polygon(points: Vec3[], view: View, stage?: Stage) {
  return points
    .map((p) => {
      const v = project(p, view, stage);
      return `${v.x},${v.y}`;
    })
    .join(" ");
}
