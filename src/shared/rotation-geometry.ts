export type Cell = readonly [number, number];
export type Shape = readonly Cell[];
export type Point = readonly [number, number];
const cellKey = ([x, y]: Cell) => `${x},${y}`;

export function normalizeShape(shape: Shape): Cell[] {
  const minX = Math.min(...shape.map(([x]) => x));
  const minY = Math.min(...shape.map(([, y]) => y));
  return shape
    .map(([x, y]) => [x - minX, y - minY] as Cell)
    .sort(([x, y], [a, b]) => x - a || y - b);
}
function exactKey(shape: Shape) {
  return normalizeShape(shape).map(cellKey).join(";");
}
function turn(shape: Shape): Cell[] {
  return shape.map(([x, y]) => [-y, x]);
}
function reflected(shape: Shape): Cell[] {
  return shape.map(([x, y]) => [-x, y]);
}
function rotations(shape: Shape): string[] {
  const keys: string[] = [];
  for (let i = 0; i < 4; i++) {
    keys.push(exactKey(shape));
    shape = turn(shape);
  }
  return keys;
}
export function shapeKey(shape: Shape): string {
  return [...rotations(shape), ...rotations(reflected(shape))].sort()[0];
}

// Cancel shared cell edges, then trace the sole outer boundary. Multiple loops
// (holes) and pinched vertices are rejected rather than rendered ambiguously.
export function shapeOutline(shape: Shape): Point[] {
  const cells = normalizeShape(shape);
  const edges = new Map<string, { from: Point; to: Point }>();
  for (const [x, y] of cells) {
    const corners: Point[] = [
      [x, y],
      [x + 1, y],
      [x + 1, y + 1],
      [x, y + 1],
    ];
    for (let i = 0; i < 4; i++) {
      const from = corners[i],
        to = corners[(i + 1) % 4];
      const reverse = `${cellKey(to)}|${cellKey(from)}`;
      if (edges.has(reverse)) edges.delete(reverse);
      else edges.set(`${cellKey(from)}|${cellKey(to)}`, { from, to });
    }
  }
  const next = new Map<string, { from: Point; to: Point }>();
  for (const edge of edges.values()) {
    const key = cellKey(edge.from);
    if (next.has(key)) throw new Error("图形边界相交");
    next.set(key, edge);
  }
  const first = next.values().next().value;
  if (!first) throw new Error("图形为空");
  const points: Point[] = [];
  let current = first.from;
  for (let i = 0; i < edges.size; i++) {
    const edge = next.get(cellKey(current));
    if (!edge) throw new Error("图形边界不完整");
    points.push(current);
    next.delete(cellKey(current));
    current = edge.to;
    if (cellKey(current) === cellKey(first.from)) break;
  }
  if (next.size || cellKey(current) !== cellKey(first.from))
    throw new Error("图形存在孔洞或分离区域");
  const cx = (Math.max(...cells.map(([x]) => x)) + 1) / 2;
  const cy = (Math.max(...cells.map(([, y]) => y)) + 1) / 2;
  return points.map(([x, y]) => [x - cx, y - cy]);
}

export function isRotationShape(shape: Shape, size: number): boolean {
  if (
    !Array.isArray(shape) ||
    shape.length !== size ||
    ![6, 10].includes(size) ||
    shape.some(
      (p) =>
        !Array.isArray(p) ||
        p.length !== 2 ||
        p.some((n) => !Number.isSafeInteger(n) || Math.abs(n) > 100),
    ) ||
    new Set(shape.map(cellKey)).size !== size
  )
    return false;
  const cells = new Set(shape.map(cellKey));
  const seen = new Set<string>([cellKey(shape[0])]);
  const queue = [shape[0]];
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    for (const p of [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as Cell[]) {
      const key = cellKey(p);
      if (cells.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(p);
      }
    }
  }
  if (seen.size !== size) return false;
  const keys = rotations(shape);
  if (
    keys.slice(1).includes(keys[0]) ||
    rotations(reflected(shape)).includes(keys[0])
  )
    return false;
  try {
    shapeOutline(shape);
    return true;
  } catch {
    return false;
  }
}

export function rotatePoints(
  points: readonly Point[],
  degrees: number,
): Point[] {
  const radians = (degrees * Math.PI) / 180,
    c = Math.cos(radians),
    s = Math.sin(radians);
  return points.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}
export function rotationPair(trial: {
  shape: Shape;
  baseTurns: number;
  rotation: number;
  relation: "rotation" | "mirror";
}) {
  const reference = rotatePoints(
    shapeOutline(trial.shape),
    trial.baseTurns * 90,
  );
  const comparison = rotatePoints(
    trial.relation === "mirror"
      ? reference.map(([x, y]) => [-x, y] as Point)
      : reference,
    trial.rotation,
  );
  const radius = Math.max(...reference.map(([x, y]) => Math.hypot(x, y))) + 0.5;
  return {
    reference,
    comparison,
    viewBox: `${-radius} ${-radius} ${2 * radius} ${2 * radius}`,
  };
}
export function outlinePath(points: readonly Point[]): string {
  return (
    points
      .map(
        ([x, y], i) =>
          `${i ? "L" : "M"}${Number(x.toFixed(6))},${Number(y.toFixed(6))}`,
      )
      .join(" ") + " Z"
  );
}
