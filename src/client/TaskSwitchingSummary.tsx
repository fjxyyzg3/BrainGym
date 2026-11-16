import type { TaskSwitchingSummary as Summary } from "../shared/contracts";
import {
  taskSwitchingGroupMetrics,
  taskSwitchingMetrics,
  taskSwitchingTotals,
} from "../shared/task-switching";

export const formatTaskSwitchingTime = (value: number | null) =>
  value === null ? "—" : `${Math.round(value)} ms`;
export function TaskSwitchingSummary({ summary }: { summary: Summary }) {
  const metrics = taskSwitchingMetrics(summary);
  const total = taskSwitchingTotals(summary);
  return (
    <div className="task-switching-summary">
      <div className="task-switching-headline-stats">
        <div>
          <span>准确率</span>
          <strong data-testid="task-switching-score">
            {metrics.score.toFixed(1)}%
          </strong>
        </div>
        <div>
          <span>正确题平均反应时间</span>
          <strong>{formatTaskSwitchingTime(metrics.meanCorrectRtMs)}</strong>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">
            整体、重复题与切换题表现
          </caption>
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
                ["重复题", summary.repeat],
                ["切换题", summary.switch],
              ] as const
            ).map(([name, g]) => {
              const m = taskSwitchingGroupMetrics(g);
              return (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{m.score.toFixed(1)}%</td>
                  <td>{formatTaskSwitchingTime(m.meanCorrectRtMs)}</td>
                  <td>{g.correct}</td>
                  <td>{g.wrong}</td>
                  <td>{g.timeout}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">整体</th>
              <td>{metrics.score.toFixed(1)}%</td>
              <td>{formatTaskSwitchingTime(metrics.meanCorrectRtMs)}</td>
              <td>{total.correct}</td>
              <td>{total.wrong}</td>
              <td>{total.timeout}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="fine">
        切换耗时差：
        <strong>{formatTaskSwitchingTime(metrics.switchCostMs)}</strong>
        （切换题 − 重复题；负值表示切换题更快）
      </p>
      <p className="fine">反应时间只统计正确题；没有正确题时显示“—”。</p>
    </div>
  );
}
