import type { StroopSummary as Summary } from "../shared/contracts";
import { stroopGroupMetrics, stroopMetrics } from "../shared/stroop";

export const formatStroopTime = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)} ms`;
export function StroopSummary({ summary }: { summary: Summary }) {
  const metrics = stroopMetrics(summary);
  return (
    <div className="stroop-summary">
      <div className="stroop-headline-stats">
        <div>
          <span>准确率</span>
          <strong data-testid="stroop-score">
            {metrics.score.toFixed(1)}%
          </strong>
        </div>
        <div>
          <span>正确题平均反应时间</span>
          <strong>{formatStroopTime(metrics.meanCorrectRtMs)}</strong>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">一致题与干扰题表现</caption>
          <thead>
            <tr>
              {["题型", "准确率", "正确平均耗时", "正确", "错误", "超时"].map(
                (x) => (
                  <th key={x} scope="col">
                    {x}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["一致题", summary.congruent],
                ["干扰题", summary.incongruent],
              ] as const
            ).map(([name, g]) => {
              const m = stroopGroupMetrics(g);
              return (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{m.score.toFixed(1)}%</td>
                  <td>{formatStroopTime(m.meanCorrectRtMs)}</td>
                  <td>{g.correct}</td>
                  <td>{g.wrong}</td>
                  <td>{g.timeout}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fine">
        干扰耗时差：<strong>{formatStroopTime(metrics.interferenceMs)}</strong>
        （干扰题 − 一致题；负值表示干扰题更快）
      </p>
      <p className="fine">反应时间只统计正确题；没有正确题时显示“—”。</p>
    </div>
  );
}
