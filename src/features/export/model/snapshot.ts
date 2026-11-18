import type { Document, Paper, Step, Vec3, View } from "../../../shared/types";
/** 导出任务的冻结输入：开始那一刻确认的作品，之后编辑不影响它。 */
export interface Snapshot {
  paper: Paper;
  front: string;
  back: string;
  texture: string;
  steps: Step[];
  view: View;
}
const clonePoints = (points: Vec3[]): Vec3[] =>
  points.map((p) => [p[0], p[1], p[2]] as Vec3);
export function takeSnapshot(doc: Document): Snapshot {
  return {
    paper: {
      ...doc.paper,
      faces: doc.paper.faces.map((f) => ({
        ...f,
        points: clonePoints(f.points),
        hinge: f.hinge ? (clonePoints(f.hinge) as [Vec3, Vec3]) : undefined,
      })),
      creases: doc.paper.creases.map((c) => ({ ...c })),
    },
    front: doc.front,
    back: doc.back,
    texture: doc.texture,
    steps: doc.steps.map((s) => ({ ...s, angles: { ...s.angles } })),
    view: { ...doc.view },
  };
}
