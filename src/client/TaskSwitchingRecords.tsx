import { useEffect, useState } from "react";
import { api } from "./api";
import {
  TaskSwitchingSummary,
  formatTaskSwitchingTime,
} from "./TaskSwitchingSummary";
import {
  GAME_IDS,
  GAME_NAMES,
  TASK_SWITCHING_GAME,
  type GameId,
  type TaskSwitchingHistory,
  type TaskSwitchingSavedResult,
  type User,
} from "../shared/contracts";

export function TaskSwitchingRecords({
  user,
  revision,
  onGame,
  onTrain,
  onLogin,
  onError,
  onUser,
}: {
  user: User | null;
  revision: number;
  onGame: (game: GameId) => void;
  onTrain: (game: GameId) => void;
  onLogin: () => void;
  onError: (err: unknown) => void;
  onUser: (user: User) => void;
}) {
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{
    userId: string;
    page: number;
    history: TaskSwitchingHistory;
    best: TaskSwitchingSavedResult | null;
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setPage(1);
    setLoaded(null);
  }, [user?.id]);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError("");
    if (!user) return;
    void Promise.all([
      api<TaskSwitchingHistory & { user: User }>(
        `history?page=${page}&game=${TASK_SWITCHING_GAME}`,
      ),
      api<{ items: TaskSwitchingSavedResult[]; user: User }>(
        `bests?game=${TASK_SWITCHING_GAME}`,
      ),
    ])
      .then(([h, b]) => {
        if (cancelled) return;
        if (h.user.id !== user.id || b.user.id !== user.id) {
          onUser(h.user);
          throw new Error("账户发生变化，请重新查看记录");
        }
        setLoaded({
          userId: user.id,
          page,
          history: h,
          best: b.items[0] ?? null,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError((err as Error).message);
          onError(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, page, refresh, revision, onError, onUser]);
  const current =
    loaded?.userId === user?.id && loaded?.page === page ? loaded : null;
  return (
    <>
      <div className="records-title">
        <div>
          <h1>个人记录</h1>
          <p>观察准确率，以及答对时的反应速度。</p>
        </div>
        {user && (
          <button
            className="secondary compact"
            onClick={() => onTrain(TASK_SWITCHING_GAME)}
          >
            开始训练
          </button>
        )}
      </div>
      {!user ? (
        <section className="empty-state card">
          <h2>登录后查看个人记录</h2>
          <p>游客成绩不上传，登录后不会补传。</p>
          <button className="primary" onClick={onLogin}>
            Token 登录
          </button>
        </section>
      ) : (
        <>
          <div className="mode-options" role="group" aria-label="记录模式">
            {GAME_IDS.map((id) => (
              <button
                key={id}
                className={id === TASK_SWITCHING_GAME ? "selected" : ""}
                aria-pressed={id === TASK_SWITCHING_GAME}
                onClick={() => onGame(id)}
              >
                {GAME_NAMES[id]}
              </button>
            ))}
          </div>
          <div className="section-heading">
            <h2>历次最佳</h2>
            <span>准确率优先，同准确率比较正确平均耗时</span>
          </div>
          <section
            className="card task-switching-panel"
            data-testid="task-switching-best"
          >
            {current?.best ? (
              <TaskSwitchingSummary summary={current.best} />
            ) : (
              <p>{error ? "读取失败" : !current ? "正在读取…" : "暂无记录"}</p>
            )}
          </section>
          <div className="section-heading history-heading">
            <h2>训练历史</h2>
            <span>
              {current ? `共 ${current.history.total} 局` : "仅本人可见"}
            </span>
          </div>
          {error ? (
            <div className="card error-panel">
              <p role="alert">{error}</p>
              <button
                className="secondary"
                onClick={() => setRefresh((x) => x + 1)}
              >
                重新加载
              </button>
            </div>
          ) : !current ? (
            <p role="status">正在读取记录…</p>
          ) : !current.history.items.length ? (
            <div className="card empty-row">
              <p>还没有训练记录。</p>
              <button
                className="text-link"
                onClick={() => onTrain(TASK_SWITCHING_GAME)}
              >
                开始第一局
              </button>
            </div>
          ) : (
            <>
              <div className="task-switching-history">
                {current.history.items.map((row) => (
                  <article
                    className="card task-switching-panel"
                    key={row.resultId}
                  >
                    <h3>{new Date(row.completedAt).toLocaleString("zh-CN")}</h3>
                    <p className="fine">
                      准确率 {row.score.toFixed(1)}% · 正确平均耗时{" "}
                      {formatTaskSwitchingTime(row.meanCorrectRtMs)}
                    </p>
                    <TaskSwitchingSummary summary={row} />
                  </article>
                ))}
              </div>
              <div className="pagination">
                <button
                  className="secondary compact"
                  disabled={page <= 1}
                  onClick={() => setPage((x) => x - 1)}
                >
                  上一页
                </button>
                <span>第 {page} 页</span>
                <button
                  className="secondary compact"
                  disabled={
                    page * current.history.pageSize >= current.history.total
                  }
                  onClick={() => setPage((x) => x + 1)}
                >
                  下一页
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
