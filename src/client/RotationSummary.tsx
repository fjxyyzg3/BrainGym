import type {
  RotationSummary as Summary,
  RotationGroup,
} from "../shared/contracts";
import {
  ROTATION_ANGLES,
  ROTATION_COMPLEXITIES,
  ROTATION_COMPLEXITY_NAMES,
  rotationGroupMetrics,
} from "../shared/mental-rotation";

export const formatRotationTime = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)} ms`;
function Breakdown({
  caption,
  rows,
}: {
  caption: string;
  rows: readonly (readonly [string, readonly RotationGroup[]])[];
}) {
  return (
    <table className="rotation-breakdown">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {["类别", "正确／错误", "准确率", "正确平均用时"].map((label) => (
            <th scope="col" key={label}>
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, groups]) => {
          const m = rotationGroupMetrics(groups);
          return (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                {m.correct}／{m.wrong}
              </td>
              <td>{m.score.toFixed(1)}%</td>
              <td>{formatRotationTime(m.meanCorrectRtMs)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
export function RotationSummary({ summary }: { summary: Summary }) {
  const m = rotationGroupMetrics(summary.groups);
  return (
    <div className="rotation-summary">
      <div className="rotation-headline-stats">
        <div>
          <span>准确率</span>
          <strong data-testid="rotation-score">{m.score.toFixed(1)}%</strong>
        </div>
        <div>
          <span>正确题平均用时</span>
          <strong>{formatRotationTime(m.meanCorrectRtMs)}</strong>
        </div>
      </div>
      <p>
        正确 {m.correct} 题 · 错误 {m.wrong} 题 · 共 {m.correct + m.wrong} 题
      </p>
      <Breakdown
        caption="按旋转角度"
        rows={ROTATION_ANGLES.map(
          (a) =>
            [`${a}°`, summary.groups.filter((g) => g.angle === a)] as const,
        )}
      />
      <Breakdown
        caption="按图形复杂度"
        rows={ROTATION_COMPLEXITIES.map(
          (c) =>
            [
              ROTATION_COMPLEXITY_NAMES[c],
              summary.groups.filter((g) => g.complexity === c),
            ] as const,
        )}
      />
      <p className="fine">
        用时只统计正确题，不含反馈时间；没有正确题时显示“—”。
      </p>
    </div>
  );
}
