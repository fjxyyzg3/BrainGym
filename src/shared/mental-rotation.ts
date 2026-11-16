import type {
  RotationAngle,
  RotationComplexity,
  RotationRelation,
  RotationGroup,
  RotationSummary,
  RotationMetrics,
} from "./contracts.js";
import {
  isRotationShape,
  normalizeShape,
  shapeKey,
  type Cell,
  type Shape,
} from "./rotation-geometry.js";
import { ROTATION_SHAPES } from "./rotation-shapes.js";

export const ROTATION_ANGLES = [45, 90, 135, 180] as const;
export const ROTATION_COMPLEXITIES = ["simple", "complex"] as const;
export const ROTATION_RELATIONS = ["rotation", "mirror"] as const;
export const ROTATION_FEEDBACK_MS = 800;
export const ROTATION_RELATION_NAMES: Record<RotationRelation, string> = {
  rotation: "仅旋转",
  mirror: "镜像",
};
export const ROTATION_COMPLEXITY_NAMES: Record<RotationComplexity, string> = {
  simple: "简单图形",
  complex: "复杂图形",
};
export interface RotationTrial {
  shape: Cell[];
  complexity: RotationComplexity;
  angle: RotationAngle;
  relation: RotationRelation;
  baseTurns: number;
  rotation: number;
}
export const rotationGroupKey = (
  g: Pick<RotationGroup, "complexity" | "angle" | "relation">,
) => `${g.complexity}:${g.angle}:${g.relation}`;
export function emptyRotationSummary(): RotationSummary {
  return {
    groups: ROTATION_COMPLEXITIES.flatMap((complexity) =>
      ROTATION_ANGLES.flatMap((angle) =>
        ROTATION_RELATIONS.map((relation) => ({
          complexity,
          angle,
          relation,
          correct: 0,
          wrong: 0,
          correctRtTotalMs: 0,
        })),
      ),
    ),
  };
}
function picker(random: () => number) {
  return (n: number) => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("随机源无效");
    return Math.floor(value * n);
  };
}
function shuffle<T>(items: T[], pick: (n: number) => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
function growShape(size: number, pick: (n: number) => number): Cell[] {
  const shape: Cell[] = [[0, 0]],
    used = new Set(["0,0"]);
  for (let i = 1; i < size; i++) {
    const frontier = new Map<string, Cell>();
    for (const [x, y] of shape)
      for (const p of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as Cell[]) {
        if (!used.has(p.join(","))) frontier.set(p.join(","), p);
      }
    const p = [...frontier.values()][pick(frontier.size)];
    shape.push(p);
    used.add(p.join(","));
  }
  return normalizeShape(shape);
}
export function generateRotationTrials(
  warmup = false,
  random = Math.random,
): RotationTrial[] {
  const pick = picker(random),
    used = new Set<string>();
  const types: Pick<RotationTrial, "complexity" | "angle" | "relation">[] = [];
  if (warmup) {
    const mirrors = shuffle([true, true, false, false], pick);
    ROTATION_COMPLEXITIES.forEach((complexity, c) =>
      ROTATION_ANGLES.forEach((angle, a) =>
        types.push({
          complexity,
          angle,
          relation: (c ? !mirrors[a] : mirrors[a]) ? "mirror" : "rotation",
        }),
      ),
    );
  } else {
    for (const g of emptyRotationSummary().groups)
      for (let i = 0; i < 2; i++)
        types.push({
          complexity: g.complexity,
          angle: g.angle,
          relation: g.relation,
        });
  }
  const trials = types.map((type) => {
    const size = type.complexity === "simple" ? 6 : 10;
    let shape: Shape | undefined;
    for (let attempt = 0; attempt < 128; attempt++) {
      const candidate = growShape(size, pick);
      if (isRotationShape(candidate, size) && !used.has(shapeKey(candidate))) {
        shape = candidate;
        break;
      }
    }
    shape ??= ROTATION_SHAPES[type.complexity].find(
      (candidate) =>
        !used.has(shapeKey(candidate)) && isRotationShape(candidate, size),
    );
    if (!shape) throw new Error("无法准备完整心理旋转题目，请重试");
    used.add(shapeKey(shape));
    return {
      ...type,
      shape: normalizeShape(shape),
      baseTurns: pick(4),
      rotation: type.angle === 180 ? 180 : type.angle * (pick(2) ? 1 : -1),
    };
  });
  return shuffle(trials, pick);
}
export function validateRotationSummary(
  value: unknown,
  warmup = false,
): asserts value is RotationSummary {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("统计无效");
  const groups = (value as RotationSummary).groups;
  if (!Array.isArray(groups) || groups.length !== 16)
    throw new Error("分类统计无效");
  const seen = new Set<string>();
  let total = 0,
    totalMs = 0;
  for (const g of groups) {
    if (
      !g ||
      typeof g !== "object" ||
      Array.isArray(g) ||
      !ROTATION_COMPLEXITIES.includes(g.complexity) ||
      !ROTATION_ANGLES.includes(g.angle) ||
      !ROTATION_RELATIONS.includes(g.relation) ||
      ![g.correct, g.wrong, g.correctRtTotalMs].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      (!warmup && g.correct + g.wrong !== 2) ||
      (warmup && g.correct + g.wrong > 8) ||
      (g.correct === 0 && g.correctRtTotalMs !== 0) ||
      seen.has(rotationGroupKey(g))
    )
      throw new Error("分类统计无效");
    seen.add(rotationGroupKey(g));
    total += g.correct + g.wrong;
    totalMs += g.correctRtTotalMs;
    if (!Number.isSafeInteger(totalMs)) throw new Error("正确耗时总和无效");
  }
  if (total !== (warmup ? 8 : 32)) throw new Error("题量无效");
  if (
    warmup &&
    (ROTATION_COMPLEXITIES.some(
      (c) => !groups.some((g) => g.complexity === c && g.correct + g.wrong > 0),
    ) ||
      ROTATION_ANGLES.some(
        (a) => !groups.some((g) => g.angle === a && g.correct + g.wrong > 0),
      ) ||
      ROTATION_RELATIONS.some(
        (r) => !groups.some((g) => g.relation === r && g.correct + g.wrong > 0),
      ))
  )
    throw new Error("热身分类覆盖不足");
}
export function canonicalRotationGroups(
  summary: RotationSummary,
): RotationGroup[] {
  return emptyRotationSummary().groups.map((key) => {
    const g = summary.groups.find(
      (g) => rotationGroupKey(g) === rotationGroupKey(key),
    )!;
    return {
      complexity: g.complexity,
      angle: g.angle,
      relation: g.relation,
      correct: g.correct,
      wrong: g.wrong,
      correctRtTotalMs: g.correctRtTotalMs,
    };
  });
}
export function rotationGroupMetrics(groups: readonly RotationGroup[]) {
  const correct = groups.reduce((sum, g) => sum + g.correct, 0),
    wrong = groups.reduce((sum, g) => sum + g.wrong, 0);
  return {
    correct,
    wrong,
    score: correct + wrong ? (100 * correct) / (correct + wrong) : 0,
    meanCorrectRtMs: correct
      ? groups.reduce((sum, g) => sum + g.correctRtTotalMs, 0) / correct
      : null,
  };
}
export function rotationMetrics(summary: RotationSummary): RotationMetrics {
  const { score, meanCorrectRtMs } = rotationGroupMetrics(summary.groups);
  return { score, meanCorrectRtMs };
}
